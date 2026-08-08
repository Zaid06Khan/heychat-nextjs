/**
 * End-to-end walkthrough: register -> login -> send a message.
 * Exercises the real route handlers and the real RLS policies.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const APP = process.argv[2] || 'http://localhost:3000';
const DOMAIN = env.HEYCHAT_SYNTHETIC_EMAIL_DOMAIN;
const FP = 'e2e-fixed-device-fingerprint';

const stamp = Date.now().toString().slice(-6);
const alice = `alice_${stamp}`;
const bob = `bob_${stamp}`;
const carol = `carol_${stamp}`;
const PW = 'correct-horse-battery';

let pass = 0;
let fail = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${extra ? '  -- ' + extra : ''}`);
  ok ? pass++ : fail++;
};

const post = async (path, body) => {
  const res = await fetch(APP + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

const signedInClient = async (username) => {
  const c = createClient(URL, ANON);
  const { error } = await c.auth.signInWithPassword({
    email: `${username}@${DOMAIN}`,
    password: PW,
  });
  if (error) throw new Error(`sign-in failed for ${username}: ${error.message}`);
  return c;
};

console.log('\n--- 1. REGISTER ---');
const rA = await post('/api/auth/register', {
  username: alice, password: PW, display_name: 'Alice',
  recovery_password: 'alice-recovery-phrase', device_fingerprint: FP,
});
check(rA.status === 200 && rA.json?.account?.username === alice,
  `register ${alice}`, `status=${rA.status} ${rA.json?.error || ''}`);

const rB = await post('/api/auth/register', {
  username: bob, password: PW, display_name: 'Bob', device_fingerprint: FP,
});
check(rB.status === 200, `register ${bob}`, `status=${rB.status} ${rB.json?.error || ''}`);

const rC = await post('/api/auth/register', {
  username: carol, password: PW, display_name: 'Carol', device_fingerprint: FP,
});
check(rC.status === 200, `register ${carol}`, `status=${rC.status} ${rC.json?.error || ''}`);

const dup = await post('/api/auth/register', {
  username: alice, password: PW, device_fingerprint: FP,
});
check(dup.status === 409, 'duplicate username rejected', `status=${dup.status}`);

const weak = await post('/api/auth/register', {
  username: `weak_${stamp}`, password: 'short', device_fingerprint: FP,
});
check(weak.status === 400, 'short password rejected', `status=${weak.status}`);

console.log('\n--- 2. PASSWORD IS NOT IN THE DATABASE ---');
const admin = createClient(URL, SVC);
const { data: aliceRow } = await admin.from('accounts').select('*').eq('username', alice).single();
check(aliceRow && !('password_hash' in aliceRow),
  'accounts row has no password_hash column');
check(!JSON.stringify(aliceRow).includes(PW), 'plaintext password not stored in accounts');

console.log('\n--- 3. LOGIN ---');
const okLogin = await post('/api/auth/login', { username: alice, password: PW, device_fingerprint: FP });
check(okLogin.status === 200, `login ${alice}`, `status=${okLogin.status} ${okLogin.json?.error || ''}`);

const badPw = await post('/api/auth/login', { username: alice, password: 'wrong-password', device_fingerprint: FP });
check(badPw.status === 401, 'wrong password rejected', `status=${badPw.status}`);

const noUser = await post('/api/auth/login', { username: `ghost_${stamp}`, password: PW, device_fingerprint: FP });
check(noUser.status === 401 && noUser.json?.error === badPw.json?.error,
  'unknown user gives same error as wrong password (no enumeration)');

const badDevice = await post('/api/auth/login', { username: alice, password: PW, device_fingerprint: 'some-other-device' });
check(badDevice.status === 403, 'unrecognized device rejected', `status=${badDevice.status}`);

console.log('\n--- 4. SEND A MESSAGE ---');
const A = await signedInClient(alice);
const B = await signedInClient(bob);
const C = await signedInClient(carol);

const aliceId = rA.json.account.id;
const bobId = rB.json.account.id;

const { data: conv, error: convErr } = await A.from('conversations')
  .insert({ type: 'direct', participant_ids: [aliceId, bobId], disappearing_timer: 0 })
  .select().single();
check(!!conv, 'alice creates a direct conversation', convErr?.message || '');

const { data: msg, error: msgErr } = await A.from('messages')
  .insert({ conversation_id: conv.id, sender_id: aliceId, content: 'hello bob', message_type: 'text', read_by: [aliceId] })
  .select().single();
check(!!msg, 'alice sends a message', msgErr?.message || '');

const { data: bobSees } = await B.from('messages').select('*').eq('conversation_id', conv.id);
check(bobSees?.length === 1 && bobSees[0].content === 'hello bob', 'bob can read it');

const { data: carolSees } = await C.from('messages').select('*').eq('conversation_id', conv.id);
check(carolSees?.length === 0, 'carol (not a participant) sees nothing', `saw ${carolSees?.length}`);

const { error: carolInsert } = await C.from('messages')
  .insert({ conversation_id: conv.id, sender_id: carolId(), content: 'intruding', message_type: 'text' });
function carolId() { return rC.json.account.id; }
check(!!carolInsert, 'carol cannot post into that conversation', carolInsert?.message || 'NO ERROR');

const { error: spoof } = await B.from('messages')
  .insert({ conversation_id: conv.id, sender_id: aliceId, content: 'forged from alice', message_type: 'text' });
check(!!spoof, 'bob cannot send a message as alice', spoof?.message || 'NO ERROR');

console.log('\n--- 5. READ RECEIPTS ---');
const { error: rpcErr } = await B.rpc('mark_message_read', { message_id: msg.id });
check(!rpcErr, 'bob marks the message read via RPC', rpcErr?.message || '');
const { data: afterRead } = await A.from('messages').select('read_by').eq('id', msg.id).single();
check(afterRead?.read_by?.includes(bobId), 'read_by now contains bob');

const { data: tamper } = await B.from('messages').update({ content: 'TAMPERED' }).eq('id', msg.id).select();
check(!tamper || tamper.length === 0, 'bob cannot edit alice\'s message text');

console.log('\n--- 6. SECRETS AND PRIVILEGE ---');
const { error: secretsErr } = await A.from('account_secrets').select('*');
check(!!secretsErr, 'account_secrets unreadable by a signed-in user', secretsErr?.message || 'NO ERROR');

const { data: promoted } = await A.from('accounts').update({ role: 'admin' }).eq('id', aliceId).select();
check(!promoted || promoted.length === 0, 'alice cannot promote herself to admin');

const { data: otherUpd } = await A.from('accounts').update({ bio: 'hacked' }).eq('id', bobId).select();
check(!otherUpd || otherUpd.length === 0, 'alice cannot edit bob\'s profile');

const { data: ownUpd, error: ownErr } = await A.from('accounts').update({ bio: 'hi' }).eq('id', aliceId).select();
check(ownUpd?.length === 1, 'alice can edit her own profile', ownErr?.message || '');

console.log('\n--- 7. EARNINGS ---');
const { error: bobEarnErr } = await B.from('earnings')
  .insert({ account_id: aliceId, activity_type: 'ad_watch', reward_amount: 999, status: 'credited' });
check(!!bobEarnErr, 'bob cannot credit alice\'s balance', bobEarnErr?.message || 'NO ERROR');

// Was the known hole: the amount used to be whatever the browser sent.
// 0005_earnings.sql revoked client INSERT at both the grant and policy layer.
const { error: selfEarnErr } = await A.from('earnings')
  .insert({ account_id: aliceId, activity_type: 'ad_watch', reward_amount: 999, status: 'credited' });
check(!!selfEarnErr, 'alice cannot mint her own earnings either', selfEarnErr?.message || 'NO ERROR');

// The rate card is server-side: RLS is on with no policy for `authenticated`,
// so a direct read returns nothing even though the RPC can see it.
const { data: rateRows, error: rateErr } = await A.from('earn_rewards').select('*');
check(!!rateErr || (rateRows || []).length === 0,
  'alice cannot read the reward rate card directly', rateErr?.message || `${(rateRows||[]).length} rows`);

// The only sanctioned path. Takes a type, never an amount.
const { data: credited, error: creditErr } = await A.rpc('credit_earning', { p_activity: 'ad_watch' });
check(!creditErr, 'alice can credit through credit_earning()', creditErr?.message);
check(Number(credited?.reward_amount) === 0.05,
  'the server sets the amount, not the caller', `got ${credited?.reward_amount}`);

// Passing an amount is not a thing the function accepts.
const { error: forgedErr } = await A.rpc('credit_earning', { p_activity: 'ad_watch', reward_amount: 999 });
check(!!forgedErr, 'credit_earning() rejects a caller-supplied amount', forgedErr?.message || 'NO ERROR');

const { error: bogusErr } = await A.rpc('credit_earning', { p_activity: 'not_a_real_activity' });
check(!!bogusErr, 'credit_earning() rejects an unknown activity', bogusErr?.message || 'NO ERROR');

console.log(`\n=========== ${pass} passed, ${fail} failed ===========\n`);

// cleanup
for (const id of [aliceId, bobId, rC.json.account.id]) {
  await admin.auth.admin.deleteUser(id).catch(() => {});
}
console.log('test users deleted');
process.exit(fail ? 1 : 0);
