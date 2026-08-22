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

/**
 * Sign in the way the app does: by LOOKING UP the auth address, not rebuilding
 * it from the username.
 *
 * This helper used to compose `<username>@<domain>` itself, and 0026 broke it
 * on the first run — which is the point. Since 0026 a new account's GoTrue
 * identity is a random uuid that has nothing to do with its name, so anything
 * still deriving the address finds no user. That is exactly the failure a
 * username change would have caused before, reproduced here by the change that
 * fixes it.
 */
const signedInClient = async (username) => {
  const { data: row } = await admin
    .from('accounts')
    .select('auth_email')
    .eq('username', username)
    .maybeSingle();

  const c = createClient(URL, ANON);
  const { error } = await c.auth.signInWithPassword({
    email: row?.auth_email || `${username}@${DOMAIN}`,
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
  username: bob, password: PW, display_name: 'Bob',
  recovery_password: 'bob-recovery-phrase', device_fingerprint: FP,
});
check(rB.status === 200, `register ${bob}`, `status=${rB.status} ${rB.json?.error || ''}`);

const rC = await post('/api/auth/register', {
  username: carol, password: PW, display_name: 'Carol',
  recovery_password: 'carol-recovery-phrase', device_fingerprint: FP,
});
check(rC.status === 200, `register ${carol}`, `status=${rC.status} ${rC.json?.error || ''}`);

const dup = await post('/api/auth/register', {
  username: alice, password: PW,
  recovery_password: 'another-recovery-phrase', device_fingerprint: FP,
});
check(dup.status === 409, 'duplicate username rejected', `status=${dup.status}`);

const weak = await post('/api/auth/register', {
  username: `weak_${stamp}`, password: 'short',
  recovery_password: 'weak-recovery-phrase', device_fingerprint: FP,
});
check(weak.status === 400, 'short password rejected', `status=${weak.status}`);

// REQUIRED as of 2026-08-16, and this suite is why it needed asserting: it used
// to register two of its three users with no recovery password at all and get a
// 200 each time, which is exactly the hole. With device binding gone and no
// email on file, this phrase is the only way back into an account — one created
// without it is unrecoverable, so the route no longer takes the caller's word
// for whether they used the form.
const noRecovery = await post('/api/auth/register', {
  username: `norec_${stamp}`, password: PW,
});
check(noRecovery.status === 400,
  'registering without a recovery password is refused',
  `status=${noRecovery.status} ${noRecovery.json?.error || ''}`);

const shortRecovery = await post('/api/auth/register', {
  username: `shortrec_${stamp}`, password: PW, recovery_password: 'abc',
});
check(shortRecovery.status === 400,
  'and a too-short one is refused with its own message',
  `status=${shortRecovery.status} ${shortRecovery.json?.error || ''}`);

console.log('\n--- 2. PASSWORD IS NOT IN THE DATABASE ---');
const admin = createClient(URL, SVC);

/**
 * Has this migration been applied?
 *
 * Migrations here are run by hand, so a tree carrying code for a migration
 * nobody has run yet is a normal state — and assertions about that code would
 * be permanently red, which trains people to ignore the suite. Asked of the
 * ledger 0016 introduced; a database with no ledger answers "no", which is
 * correct.
 */
const migrationApplied = async (filename) => {
  const { data } = await admin
    .from('schema_migrations')
    .select('filename')
    .eq('filename', filename)
    .maybeSingle();
  return Boolean(data);
};

/**
 * Delete for everyone, whichever way this database supports.
 *
 * 0020 revokes UPDATE on `messages` from `authenticated` and routes the write
 * through delete_message_for_everyone(). Before it, the client did the update
 * itself. The suite has to work either side of that line, and every call site
 * here is incidental setup for something else — none of them is testing HOW the
 * delete happens.
 */
const has0020 = await migrationApplied('0020_edit_history.sql');
const deleteForEveryone = async (client, id) => {
  if (has0020) return client.rpc('delete_message_for_everyone', { msg_id: id });
  return client.from('messages')
    .update({ deleted_at: new Date().toISOString(), content: null, media_url: null })
    .eq('id', id);
};

const { data: aliceRow } = await admin.from('accounts').select('*').eq('username', alice).single();
check(aliceRow && !('password_hash' in aliceRow),
  'accounts row has no password_hash column');
check(!JSON.stringify(aliceRow).includes(PW), 'plaintext password not stored in accounts');

// 0022: an account can find out whether it has a way back in, without
// account_secrets ever becoming readable.
const A0 = await signedInClient(alice);
const { data: aliceHas, error: haveErr } = await A0.rpc('have_recovery_password');
check(aliceHas === true, 'an account with a recovery password is told so',
  haveErr?.message || `got ${JSON.stringify(aliceHas)}`);

const { error: secretsStillShut } = await A0.from('account_secrets').select('*');
check(!!secretsStillShut,
  'and account_secrets is still unreadable — only the boolean is exposed',
  secretsStillShut?.message || 'NO ERROR');

console.log('\n--- 3. LOGIN ---');
const okLogin = await post('/api/auth/login', { username: alice, password: PW, device_fingerprint: FP });
check(okLogin.status === 200, `login ${alice}`, `status=${okLogin.status} ${okLogin.json?.error || ''}`);

const badPw = await post('/api/auth/login', { username: alice, password: 'wrong-password', device_fingerprint: FP });
check(badPw.status === 401, 'wrong password rejected', `status=${badPw.status}`);

const noUser = await post('/api/auth/login', { username: `ghost_${stamp}`, password: PW, device_fingerprint: FP });
check(noUser.status === 401 && noUser.json?.error === badPw.json?.error,
  'unknown user gives same error as wrong password (no enumeration)');

// The inverse of what this used to assert. Device binding refused a login whose
// fingerprint did not match the one stored at signup, which made one account
// permanently one device (FOLLOWUPS #6). It was dropped on 2026-08-16, so a
// login from anywhere with the right password must now succeed — including one
// still sending the old field, which the route ignores.
const otherDevice = await post('/api/auth/login', {
  username: alice, password: PW, device_fingerprint: 'a-completely-different-device',
});
check(otherDevice.status === 200,
  'the same account signs in from a different device', `status=${otherDevice.status}`);

// Bob rather than alice: the per-username login limit is 5 per 15 minutes and
// alice is already at three route logins by this point in the run.
const noDevice = await post('/api/auth/login', { username: bob, password: PW });
check(noDevice.status === 200,
  'and with no device field at all', `status=${noDevice.status}`);

// The route that existed only to check a fingerprint is gone, and with it the
// "reset your password from the device you signed up on" path — there is
// nothing left for it to verify.
//
// NOT a 404, and that is worth writing down rather than discovering twice: the
// app is a React Router SPA behind an optional catch-all (`[[...slug]]`), so a
// path with no route handler falls through to it and returns the app shell as
// 200 HTML. What proves the endpoint is gone is that it no longer answers as
// an API at all — no JSON, so nothing that could say `ok`.
const deviceRoute = await post('/api/auth/device', { username: alice, device_fingerprint: FP });
check(deviceRoute.json === null && deviceRoute.json?.ok !== true,
  '/api/auth/device no longer answers as an API — the fingerprint reset path is gone',
  `status=${deviceRoute.status} json=${JSON.stringify(deviceRoute.json)}`);

// 0026: A USERNAME IS NO LONGER THE AUTH RECORD'S KEY.
//
// Until this migration, GoTrue knew each account by `<username>@<domain>` and
// login rebuilt that address to find the user — so renaming a username, had the
// feature ever been built, would have made the account unreachable by password
// AND by recovery phrase, because neither is what the lookup uses. It was
// latent only because nothing offered a rename.
//
// There is still no rename feature, so this does what one would do: move the
// column. If login survives that, the identity has genuinely stopped depending
// on the name.
const renamed = `${carol}_renamed`;
await admin.from('accounts').update({ username: renamed }).eq('username', carol);

const afterRename = await post('/api/auth/login', { username: renamed, password: PW });
check(afterRename.status === 200,
  'an account still logs in after its username changes',
  `status=${afterRename.status}`);

// And the old name stops working, which is the other half of it being a real
// rename rather than an alias.
const oldName = await post('/api/auth/login', { username: carol, password: PW });
check(oldName.status === 401,
  'and the old username no longer signs in',
  `status=${oldName.status}`);

// The auth record was not touched. That is the point: a rename is one column,
// not a rewrite of the identity GoTrue holds.
const { data: renamedRow } = await admin
  .from('accounts').select('auth_email').eq('username', renamed).maybeSingle();
const { data: authUsers } = await admin.auth.admin.listUsers({ perPage: 200 });
check(authUsers.users.some((u) => u.email === renamedRow?.auth_email),
  'and GoTrue still holds the address it was created with',
  renamedRow?.auth_email);

await admin.from('accounts').update({ username: carol }).eq('username', renamed);

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

console.log('\n--- 7. EARN IS GONE ---');
// The watch-and-earn feature was removed, not disabled. These three assertions
// exist so a database that skipped 0007_drop_earnings.sql fails loudly rather
// than quietly keeping a client-reachable rewards surface alive: `earnings`
// granted every authenticated user SELECT, and credit_earning() was executable
// by anyone signed in.
const { error: earningsErr } = await A.from('earnings').select('*').limit(1);
check(!!earningsErr, 'the earnings table no longer exists', earningsErr?.message || 'STILL PRESENT');

const { error: rewardsErr } = await A.from('earn_rewards').select('*').limit(1);
check(!!rewardsErr, 'the earn_rewards rate card no longer exists', rewardsErr?.message || 'STILL PRESENT');

const { error: creditErr } = await A.rpc('credit_earning', { p_activity: 'ad_watch' });
check(!!creditErr, 'credit_earning() is no longer callable', creditErr?.message || 'STILL CALLABLE');

console.log('\n--- 8. ATTACHMENTS ARE NOT PUBLIC ---');
// Logs in through the app so we get the session cookie the route handlers read.
// Deliberately bob and carol, not alice — alice is already near the per-username
// login limit added alongside this.
const cookieLogin = async (username) => {
  const res = await fetch(APP + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PW, device_fingerprint: FP }),
  });
  return (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
};

const sign = async (cookie, payload) => {
  const res = await fetch(APP + '/api/media/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(payload),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

const objectKey = `${aliceId}/${crypto.randomUUID()}.txt`;
const { error: upErr } = await A.storage
  .from('media')
  .upload(objectKey, new Blob(['top secret attachment'], { type: 'text/plain' }), {
    contentType: 'text/plain',
  });
check(!upErr, 'alice uploads an attachment into her own folder', upErr?.message || '');

const { data: mediaMsg } = await A.from('messages')
  .insert({
    conversation_id: conv.id, sender_id: aliceId, content: 'a photo',
    message_type: 'image', media_url: objectKey, read_by: [aliceId],
  })
  .select().single();
check(!!mediaMsg, 'alice sends it as a message');

// The whole point of 0006: no account, no link, no file.
const anonFetch = await fetch(`${URL}/storage/v1/object/public/media/${objectKey}`);
check(!anonFetch.ok, 'a signed-out stranger cannot fetch the object by URL', `status=${anonFetch.status}`);

const bobCookie = await cookieLogin(bob);
const carolCookie = await cookieLogin(carol);

const bobSign = await sign(bobCookie, { messageId: mediaMsg.id });
check(bobSign.status === 200 && !!bobSign.json?.url, 'bob, who is in the conversation, gets a signed URL',
  bobSign.json?.error || '');

const bobFetch = bobSign.json?.url ? await fetch(bobSign.json.url) : { ok: false, status: 0 };
check(bobFetch.ok, 'and that signed URL actually resolves', `status=${bobFetch.status}`);

const carolSign = await sign(carolCookie, { messageId: mediaMsg.id });
check(carolSign.status === 404, 'carol, who is not, is refused', `status=${carolSign.status}`);

// The hole this would reopen: signing any key you happen to hold.
const carolRaw = await sign(carolCookie, { key: objectKey });
check(carolRaw.status === 404, 'carol cannot sign the raw key either', `status=${carolRaw.status}`);

const noAuthSign = await sign('', { messageId: mediaMsg.id });
check(noAuthSign.status === 401, 'signing requires a session', `status=${noAuthSign.status}`);

// Rows written before 0006 hold an absolute public URL rather than a key.
// Those URLs stopped resolving the moment the bucket went private, so the
// resolver has to recognise them and sign the key inside. There are real rows
// like this in production, so this is not a hypothetical.
const { data: legacyMsg } = await A.from('messages')
  .insert({
    conversation_id: conv.id, sender_id: aliceId, content: 'an old photo',
    message_type: 'image', read_by: [aliceId],
    media_url: `${URL}/storage/v1/object/public/media/${objectKey}`,
  })
  .select().single();

const legacySign = await sign(bobCookie, { messageId: legacyMsg.id });
check(legacySign.status === 200 && !!legacySign.json?.url,
  'a pre-0006 absolute URL still resolves, and is now signed', legacySign.json?.error || '');

const legacyFetch = legacySign.json?.url ? await fetch(legacySign.json.url) : { ok: false, status: 0 };
check(legacyFetch.ok, 'and the old attachment still opens', `status=${legacyFetch.status}`);

await admin.storage.from('media').remove([objectKey]);

console.log('\n--- 9. PUSH SUBSCRIPTIONS ---');
// A subscription row is a capability to make someone's phone buzz, so 0008
// gives clients neither a policy nor a grant on the table. Both of these must
// fail; if either starts passing, the table has been opened up by accident.
const { data: pushRows, error: pushReadErr } = await A.from('push_subscriptions').select('*');
check(!!pushReadErr || (pushRows || []).length === 0,
  'push_subscriptions is unreadable by a signed-in user',
  pushReadErr?.message || `${(pushRows || []).length} rows`);

const { error: pushWriteErr } = await A.from('push_subscriptions')
  .insert({ account_id: aliceId, endpoint: 'https://example.invalid/x', p256dh: 'x', auth: 'y' });
check(!!pushWriteErr, 'a client cannot write a subscription directly',
  pushWriteErr?.message || 'NO ERROR');

console.log('\n--- 9b. SENDING THROUGH /api/messages ---');
// Sending used to be a client-side insert followed by a separate request to
// /api/push/notify asking for the notification. Both halves are one route now,
// so what is worth testing has changed. The old questions — can you make
// someone's phone buzz about a message you didn't send, can you replay an old
// id — are unaskable, because the caller no longer names a message. The new
// question is what the route refuses to take from you.
const send = async (cookie, body) => {
  const res = await fetch(APP + '/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

const anonSend = await send('', { conversation_id: conv.id, content: 'hello' });
check(anonSend.status === 401, 'sending requires a session', `status=${anonSend.status}`);

// Carol is not in this conversation. The read happens through her own session,
// so she cannot tell "does not exist" from "not yours" — which is the point.
const carolSend = await send(carolCookie, { conversation_id: conv.id, content: 'intruding' });
check(carolSend.status === 404, 'a non-participant cannot send into a conversation',
  `status=${carolSend.status}`);

const missingConv = await send(bobCookie, { content: 'nowhere' });
check(missingConv.status === 400, 'a send with no conversation is refused',
  `status=${missingConv.status}`);

const emptySend = await send(bobCookie, { conversation_id: conv.id, content: '   ' });
check(emptySend.status === 400, 'an empty text message is refused', `status=${emptySend.status}`);

const badType = await send(bobCookie, {
  conversation_id: conv.id, message_type: 'ransomware', content: 'x',
});
check(badType.status === 400, 'an unknown message type is refused', `status=${badType.status}`);

// The fields the client no longer decides. Bob posts a body that lies about all
// of them at once, and the route takes none of it.
const forged = await send(bobCookie, {
  conversation_id: conv.id,
  content: 'whose message is this',
  sender_id: aliceId,
  read_by: [aliceId, bobId, carolId()],
  created_date: '1999-01-01T00:00:00.000Z',
});
check(forged.status === 200 && forged.json?.message?.sender_id === bobId,
  'a forged sender_id is ignored — the session decides',
  `got ${forged.json?.message?.sender_id}`);
check(JSON.stringify(forged.json?.message?.read_by) === JSON.stringify([bobId]),
  'and read_by starts as the sender alone', JSON.stringify(forged.json?.message?.read_by));
check(new Date(forged.json?.message?.created_date).getFullYear() >= 2020,
  "and created_date is the database's, not the caller's",
  forged.json?.message?.created_date);

// expiry_at is the one the browser used to compute, which meant the browser
// could decline to. A disappearing conversation now expires a message whose
// sender explicitly asked for it not to.
await admin.from('conversations').update({ disappearing_timer: 60 }).eq('id', conv.id);
const timed = await send(bobCookie, {
  conversation_id: conv.id, content: 'should not last', expiry_at: null,
});
check(timed.status === 200 && !!timed.json?.message?.expiry_at,
  'the disappearing timer is applied server-side even when the client omits it',
  `expiry_at=${timed.json?.message?.expiry_at}`);
await admin.from('conversations').update({ disappearing_timer: 0 }).eq('id', conv.id);

// A reply pointing into another conversation would render as "original message
// unavailable" for every person who received it.
const { data: otherConv } = await admin.from('conversations')
  .insert({ type: 'direct', participant_ids: [bobId, carolId()], disappearing_timer: 0 })
  .select().single();
const { data: otherMsg } = await admin.from('messages')
  .insert({
    conversation_id: otherConv.id, sender_id: bobId, content: 'elsewhere',
    message_type: 'text', read_by: [bobId],
  })
  .select().single();

const crossReply = await send(bobCookie, {
  conversation_id: conv.id, content: 'replying across threads', reply_to_id: otherMsg.id,
});
check(crossReply.status === 400, 'a reply cannot point at a message in another conversation',
  `status=${crossReply.status}`);

const goodReply = await send(bobCookie, {
  conversation_id: conv.id, content: 'a proper reply', reply_to_id: forged.json?.message?.id,
});
check(goodReply.status === 200 && goodReply.json?.message?.reply_to_id === forged.json?.message?.id,
  'a reply within the conversation is accepted', goodReply.json?.error || '');

console.log('\n--- 10. MUTES, REACTIONS AND THE LIST RPC ---');
// Mutes are one of the few new tables clients CAN write, so the check is that
// they can only write their own. Muting on someone else's behalf would silence
// their notifications for them.
const { error: muteOwnErr } = await A.from('conversation_mutes')
  .insert({ account_id: aliceId, conversation_id: conv.id, muted_until: null });
check(!muteOwnErr, 'alice can mute her own conversation', muteOwnErr?.message || '');

const { error: muteOtherErr } = await B.from('conversation_mutes')
  .insert({ account_id: aliceId, conversation_id: conv.id });
check(!!muteOtherErr, 'bob cannot mute on alice\'s behalf', muteOtherErr?.message || 'NO ERROR');

await A.from('conversation_mutes').delete().eq('conversation_id', conv.id);

// Reactions are gated on membership of the message's conversation, via
// is_message_member(). Carol is in neither.
const { error: reactOkErr } = await A.from('message_reactions')
  .insert({ message_id: msg.id, account_id: aliceId, emoji: '👍' });
check(!reactOkErr, 'alice can react to a message in her conversation', reactOkErr?.message || '');

const { error: reactOutsiderErr } = await C.from('message_reactions')
  .insert({ message_id: msg.id, account_id: rC.json.account.id, emoji: '👍' });
check(!!reactOutsiderErr, 'carol cannot react to a message she cannot see',
  reactOutsiderErr?.message || 'NO ERROR');

const { error: reactAsOtherErr } = await B.from('message_reactions')
  .insert({ message_id: msg.id, account_id: aliceId, emoji: '🎉' });
check(!!reactAsOtherErr, 'bob cannot react as alice', reactAsOtherErr?.message || 'NO ERROR');

// The conversation-list RPC is SECURITY INVOKER on purpose. If it were ever
// changed to DEFINER it would hand the last message of any conversation to
// anyone who knew its id, and this is the assertion that would catch it.
const { data: aliceLast } = await A.rpc('last_messages_for_conversations', { conv_ids: [conv.id] });
check((aliceLast || []).length === 1, 'the list RPC returns the last message to a member',
  `got ${(aliceLast || []).length} rows`);

const { data: carolLast } = await C.rpc('last_messages_for_conversations', { conv_ids: [conv.id] });
check((carolLast || []).length === 0, 'the list RPC returns nothing to a non-member',
  `got ${(carolLast || []).length} rows`);

// Delete-for-everyone has to actually remove the body, not just flag it.
const { data: toDelete } = await A.from('messages')
  .insert({ conversation_id: conv.id, sender_id: aliceId, content: 'delete me', read_by: [aliceId] })
  .select().single();

await deleteForEveryone(A, toDelete.id);
const { data: afterDelete } = await B.from('messages').select('content, deleted_at').eq('id', toDelete.id).single();
check(!!afterDelete?.deleted_at && afterDelete.content === null,
  'a deleted message keeps no readable body', `content=${JSON.stringify(afterDelete?.content)}`);

// --- edit window and history (0020) ---
//
// The grant is the load-bearing part. A window enforced only inside an RPC is
// worth nothing while the client can still UPDATE the column directly, which is
// exactly what messages_update_sender plus a blanket UPDATE grant allowed — the
// same shape of hole 0015 closed on conversations.
if (has0020) {
  const { data: editable } = await A.from('messages')
    .insert({ conversation_id: conv.id, sender_id: aliceId, content: 'first wording', read_by: [aliceId] })
    .select().single();

  const { error: directErr } = await A.from('messages')
    .update({ content: 'rewritten behind the RPC' })
    .eq('id', editable.id);
  check(!!directErr, 'the author can no longer UPDATE a message directly',
    directErr?.message || 'NO ERROR');

  const { error: editErr } = await A.rpc('edit_message', {
    msg_id: editable.id, new_content: 'second wording',
  });
  check(!editErr, 'but can edit through the RPC', editErr?.message || '');

  const { data: hist } = await B.from('message_edits')
    .select('previous_content').eq('message_id', editable.id);
  check((hist || []).length === 1 && hist[0].previous_content === 'first wording',
    'and the previous wording is kept, readable by the other participant',
    JSON.stringify(hist));

  const { error: notMineErr } = await B.rpc('edit_message', {
    msg_id: editable.id, new_content: 'bob rewrites alice',
  });
  check(!!notMineErr, 'someone else cannot edit it', notMineErr?.message || 'NO ERROR');

  // Backdated past the window with the service role, so this isolates the time
  // check from every other guard.
  const { data: old } = await admin.from('messages')
    .insert({
      conversation_id: conv.id, sender_id: aliceId, content: 'said long ago',
      message_type: 'text', read_by: [aliceId],
      created_date: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    })
    .select().single();
  const { error: lateErr } = await A.rpc('edit_message', {
    msg_id: old.id, new_content: 'quietly rewritten two years later',
  });
  check(!!lateErr, 'and an old message can no longer be silently rewritten',
    lateErr?.message || 'NO ERROR');

  const { data: stillOld } = await B.from('messages').select('content').eq('id', old.id).single();
  check(stillOld?.content === 'said long ago', 'the old message is unchanged',
    JSON.stringify(stillOld?.content));
} else {
  console.log('  SKIP  edit window and history — 0020_edit_history.sql not applied');
  console.log('        run it, then this asserts the UPDATE grant is really gone');
}

// The storage-cleanup queue is server-only, like push_subscriptions.
const { data: mediaQueue, error: mediaQueueErr } = await A.from('expired_media').select('*');
check(!!mediaQueueErr || (mediaQueue || []).length === 0,
  'the expired-media queue is unreadable by a client',
  mediaQueueErr?.message || `${(mediaQueue || []).length} rows`);

console.log('\n--- 11. ATTACHMENTS OF DELETED AND EXPIRED MESSAGES ---');
// The delete test above used a message with no attachment, so it never
// exercised the trigger. This one does: deleting a message that HAS media must
// queue the storage key, or "delete for everyone" leaves the file behind and
// the only thing deleted is the pointer to it.
const orphanKey = `${aliceId}/${crypto.randomUUID()}.txt`;
await A.storage
  .from('media')
  .upload(orphanKey, new Blob(['attachment of a deleted message'], { type: 'text/plain' }), {
    contentType: 'text/plain',
  });

const { data: mediaMsgToDelete } = await A.from('messages')
  .insert({
    conversation_id: conv.id, sender_id: aliceId, content: 'delete me too',
    message_type: 'image', media_url: orphanKey, read_by: [aliceId],
  })
  .select().single();

await deleteForEveryone(A, mediaMsgToDelete.id);

// Read through the service role — no client can see this table, which is the point.
const { data: queuedKey } = await admin
  .from('expired_media').select('storage_key').eq('storage_key', orphanKey);
check((queuedKey || []).length === 1,
  'deleting a message queues its attachment for removal',
  `${(queuedKey || []).length} rows for that key`);

// And the collector actually removes it. Exercises the one route with no other
// coverage, end to end: queue -> Storage API -> queue cleared.
const sweepRes = await fetch(APP + '/api/cron/sweep-media', {
  method: 'POST',
  headers: { authorization: `Bearer ${env.CRON_SECRET || ''}` },
});
const sweepJson = await sweepRes.json().catch(() => null);
check(sweepRes.status === 200 && (sweepJson?.deleted ?? 0) >= 1,
  'the sweep endpoint drains the queue',
  `status=${sweepRes.status} deleted=${sweepJson?.deleted}`);

const orphanFetch = await fetch(`${URL}/storage/v1/object/public/media/${orphanKey}`);
check(!orphanFetch.ok, 'and the object is gone from storage', `status=${orphanFetch.status}`);

// The expiry sweep itself. NOTE: this deletes every already-expired message in
// the database, not just this one — which is what pg_cron would have done
// within five minutes anyway.
const { data: expiredMsg } = await admin.from('messages')
  .insert({
    conversation_id: conv.id, sender_id: aliceId, content: 'should have vanished',
    read_by: [aliceId], expiry_at: new Date(Date.now() - 60 * 1000).toISOString(),
  })
  .select().single();

const { data: sweptCount, error: sweepFnErr } = await admin.rpc('delete_expired_messages');
check(!sweepFnErr && Number(sweptCount) >= 1,
  'delete_expired_messages() reports what it deleted',
  sweepFnErr?.message || `returned ${sweptCount}`);

const { data: stillThere } = await admin.from('messages')
  .select('id').eq('id', expiredMsg.id).maybeSingle();
check(!stillThere, 'and the expired row is actually gone',
  stillThere ? 'STILL PRESENT' : '');

console.log('\n--- 11b. DELETE CHAT, AND UNFRIENDING ---');
if (await migrationApplied('0023_conversation_hides.sql')) {
  // The policy this closed was the dangerous half. Either party to a direct
  // chat could DELETE the conversation row, and messages cascade — so one
  // person could destroy the other's entire history, permanently. There was no
  // UI for it; adding a "Delete chat" button wired to the obvious thing would
  // have shipped exactly that.
  const { data: stillThere, error: destructiveErr } = await B.from('conversations')
    .delete().eq('id', conv.id).select();
  check(!!destructiveErr || (stillThere || []).length === 0,
    'a participant can no longer destroy a direct conversation for both people',
    destructiveErr?.message || `${stillThere?.length ?? 0} rows deleted`);

  const { data: convStillExists } = await admin.from('conversations')
    .select('id').eq('id', conv.id).maybeSingle();
  check(!!convStillExists, 'and the conversation is genuinely still there');

  // Hiding is a moment, not a flag: everything before it stays gone, anything
  // after is why the chat comes back.
  const hideLine = new Date().toISOString();
  const { error: hideErr } = await B.from('conversation_hides')
    .upsert({ conversation_id: conv.id, account_id: bobId, hidden_at: hideLine });
  check(!hideErr, 'bob deletes the chat for himself', hideErr?.message || '');

  const { data: bobPreview } = await B.rpc('last_messages_for_conversations', { conv_ids: [conv.id] });
  check((bobPreview || []).length === 0,
    'it stops showing a last-message preview for him',
    `got ${(bobPreview || []).length}`);

  const { data: bobUnread } = await B.rpc('unread_counts', { conv_ids: [conv.id] });
  check((bobUnread || []).length === 0, 'and stops counting as unread');

  // Alice is unaffected — that is the whole point of it being his view only.
  const { data: alicePreview } = await A.rpc('last_messages_for_conversations', { conv_ids: [conv.id] });
  check((alicePreview || []).length === 1,
    'while alice still sees the conversation and its messages',
    `got ${(alicePreview || []).length}`);

  // A new message brings it back, carrying only itself.
  await admin.from('messages').insert({
    conversation_id: conv.id, sender_id: aliceId, content: 'back from the dead',
    message_type: 'text', read_by: [aliceId],
  });
  const { data: afterNew } = await B.rpc('last_messages_for_conversations', { conv_ids: [conv.id] });
  check((afterNew || []).length === 1 && afterNew[0].content === 'back from the dead',
    'a new message brings the chat back, showing only what arrived since',
    JSON.stringify(afterNew?.[0]?.content));

  // Someone else's hide is not writable.
  const { error: hideOtherErr } = await B.from('conversation_hides')
    .insert({ conversation_id: conv.id, account_id: aliceId });
  check(!!hideOtherErr, 'and nobody can delete a chat on someone else\'s behalf',
    hideOtherErr?.message || 'NO ERROR');
} else {
  console.log('  SKIP  delete chat — 0023_conversation_hides.sql not applied');
}

// Unfriending needs no migration: RLS already lets either party delete the row.
const { data: friendship } = await admin.from('contact_requests')
  .insert({ from_account_id: aliceId, to_account_id: bobId, status: 'accepted' })
  .select().single();
check(!!friendship, 'alice and bob are contacts');

const { error: unfriendErr } = await B.from('contact_requests').delete().eq('id', friendship.id);
check(!unfriendErr, 'bob can unfriend alice from his side', unfriendErr?.message || '');

const { data: gone } = await admin.from('contact_requests').select('id').eq('id', friendship.id);
check((gone || []).length === 0, 'and the contact link is gone');

// Unfriending must not touch the conversation — the messages are still theirs.
const { data: convAfterUnfriend } = await admin.from('conversations')
  .select('id').eq('id', conv.id).maybeSingle();
check(!!convAfterUnfriend, 'while the conversation they had is left alone');

// And a stranger cannot sever someone else's friendship.
const { data: pair } = await admin.from('contact_requests')
  .insert({ from_account_id: aliceId, to_account_id: carolId(), status: 'accepted' })
  .select().single();
await B.from('contact_requests').delete().eq('id', pair.id);
const { data: survived } = await admin.from('contact_requests').select('id').eq('id', pair.id);
check((survived || []).length === 1,
  'but cannot unfriend two other people from each other');
await admin.from('contact_requests').delete().eq('id', pair.id);

console.log('\n--- 12. UNREAD COUNTS ---');
// Alice's count BEFORE she sends anything, because it is not zero and should
// not be: section 10 had bob send "sent a while ago", which she never read.
// The claim under test is that her own messages do not move her own count —
// not that she has nothing unread, which is a different and false statement.
const { data: aliceBefore } = await A.rpc('unread_counts', { conv_ids: [conv.id] });
const aliceBaseline = Number(aliceBefore?.[0]?.unread || 0);

// Alice sends two more; bob has read neither.
const { data: unreadSeed } = await A.from('messages')
  .insert([
    { conversation_id: conv.id, sender_id: aliceId, content: 'unread one', read_by: [aliceId] },
    { conversation_id: conv.id, sender_id: aliceId, content: 'unread two', read_by: [aliceId] },
  ])
  .select();

const { data: bobUnread } = await B.rpc('unread_counts', { conv_ids: [conv.id] });
const bobCount = Number(bobUnread?.[0]?.unread || 0);
check(bobCount >= 2, 'bob has unread messages from alice', `got ${bobCount}`);

// Your own messages are never unread to you. Two new ones from alice, so if
// senders counted for themselves this would have climbed by two.
const { data: aliceUnread } = await A.rpc('unread_counts', { conv_ids: [conv.id] });
const aliceCount = Number(aliceUnread?.[0]?.unread || 0);
check(aliceCount === aliceBaseline, 'alice\'s own messages do not count as unread to her',
  `${aliceBaseline} -> ${aliceCount}`);

// Reading one decrements it — this is the loop the badge depends on.
await B.rpc('mark_message_read', { message_id: unreadSeed[0].id });
const { data: afterRead2 } = await B.rpc('unread_counts', { conv_ids: [conv.id] });
check(Number(afterRead2?.[0]?.unread || 0) === bobCount - 1,
  'reading one message decrements the count',
  `${bobCount} -> ${Number(afterRead2?.[0]?.unread || 0)}`);

// A deleted message must not leave a badge pointing at a tombstone.
await deleteForEveryone(A, unreadSeed[1].id);
const { data: afterDel } = await B.rpc('unread_counts', { conv_ids: [conv.id] });
check(Number(afterDel?.[0]?.unread || 0) === bobCount - 2,
  'a deleted message stops being counted',
  `got ${Number(afterDel?.[0]?.unread || 0)}`);

// SECURITY INVOKER, same as the list RPC: carol is in no conversation here, so
// she must not learn how much traffic one has.
const { data: carolUnread } = await C.rpc('unread_counts', { conv_ids: [conv.id] });
check((carolUnread || []).length === 0,
  'a non-member gets no unread count for a conversation',
  `got ${(carolUnread || []).length} rows`);

console.log('\n--- 13. GROUP MANAGEMENT ---');
const { data: group } = await A.from('conversations')
  .insert({ type: 'group', name: 'e2e group', participant_ids: [aliceId, bobId], admin_id: aliceId })
  .select().single();
check(!!group, 'alice creates a group she administers');

// THE HOLE 0015 CLOSES. Before it, conversations_update_member let any member
// write any column — so bob could add people, remove alice, or make himself
// admin. The UPDATE grant is now narrowed to disappearing_timer.
const { data: bobAdds } = await B.from('conversations')
  .update({ participant_ids: [aliceId, bobId, carolId()] }).eq('id', group.id).select();
check(!bobAdds || bobAdds.length === 0,
  'a member cannot edit participant_ids directly', `${(bobAdds || []).length} rows updated`);

const { data: bobPromotes } = await B.from('conversations')
  .update({ admin_id: bobId }).eq('id', group.id).select();
check(!bobPromotes || bobPromotes.length === 0,
  'a member cannot make themselves admin', `${(bobPromotes || []).length} rows updated`);

const { data: bobRenames } = await B.from('conversations')
  .update({ name: 'bob was here' }).eq('id', group.id).select();
check(!bobRenames || bobRenames.length === 0,
  'a member cannot rename the group directly', `${(bobRenames || []).length} rows updated`);

// ...but the one column that IS meant to be open to any member still is.
const { error: timerErr } = await B.from('conversations')
  .update({ disappearing_timer: 60 }).eq('id', group.id);
check(!timerErr, 'a member can still set the disappearing timer', timerErr?.message || '');

// Since 0019 the admin INVITES and the invitee decides. Gated on the migration
// actually being applied: without it group_invite_member does not exist and
// every assertion below would be red on a tree that is simply not migrated yet.
if (await migrationApplied('0019_group_invites.sql')) {
  // The sanctioned paths. Since 0019 the admin INVITES and the invitee decides —
  // group_add_member is dropped, so nobody joins a group without agreeing to.
  const { error: goneErr } = await A.rpc('group_add_member', { conv_id: group.id, new_member: carolId() });
  check(!!goneErr, 'group_add_member is gone — nobody is added without being asked',
    goneErr?.message || 'NO ERROR');

  const { error: bobInviteErr } = await B.rpc('group_invite_member', { conv_id: group.id, invitee: carolId() });
  check(!!bobInviteErr, 'a non-admin cannot invite', bobInviteErr?.message || 'NO ERROR');

  // Blocking has to stop someone putting you in a room with them, or it does not
  // mean much. Carol blocks alice, so alice's invite must be refused.
  await admin.from('accounts').update({ blocked_account_ids: [aliceId] }).eq('id', carolId());
  const { error: blockedInviteErr } = await A.rpc('group_invite_member', { conv_id: group.id, invitee: carolId() });
  check(!!blockedInviteErr, 'a blocked admin cannot invite the person who blocked them',
    blockedInviteErr?.message || 'NO ERROR');
  await admin.from('accounts').update({ blocked_account_ids: [] }).eq('id', carolId());

  const { data: invite, error: aliceInviteErr } = await A.rpc('group_invite_member', { conv_id: group.id, invitee: carolId() });
  check(!aliceInviteErr && !!invite, 'the admin can invite', aliceInviteErr?.message || '');

  const { data: beforeAccept } = await A.from('conversations').select('participant_ids').eq('id', group.id).single();
  check(!(beforeAccept?.participant_ids || []).includes(carolId()),
    'and an invitation alone does NOT put carol in the group');

  // Bob is not the invitee, so answering on her behalf must fail.
  const { error: bobAnswerErr } = await B.rpc('group_invite_respond', { invite_id: invite.id, accept: true });
  check(!!bobAnswerErr, 'someone else cannot answer her invitation', bobAnswerErr?.message || 'NO ERROR');

  const { data: carolInvites } = await C.rpc('my_group_invites');
  check((carolInvites || []).some((i) => i.id === invite.id),
    'carol sees the invitation, with the group name she is not yet a member of',
    `got ${(carolInvites || []).length}`);

  const { error: acceptErr } = await C.rpc('group_invite_respond', { invite_id: invite.id, accept: true });
  check(!acceptErr, 'carol accepts', acceptErr?.message || '');

  const { data: afterAdd } = await A.from('conversations').select('participant_ids').eq('id', group.id).single();
  check((afterAdd?.participant_ids || []).includes(carolId()), 'and is now in the group');

  const { error: reAnswerErr } = await C.rpc('group_invite_respond', { invite_id: invite.id, accept: true });
  check(!!reAnswerErr, 'an answered invitation cannot be answered again',
    reAnswerErr?.message || 'NO ERROR');
} else {
  console.log('  SKIP  group invites — 0019_group_invites.sql not applied');
  console.log('        run it, then this asserts consent and the block check');
  // The rest of this section needs carol in the group, so fall back to the
  // direct add that 0019 removes.
  await A.rpc('group_add_member', { conv_id: group.id, new_member: carolId() });
}

const { error: bobRemoveErr } = await B.rpc('group_remove_member', { conv_id: group.id, member: carolId() });
check(!!bobRemoveErr, 'a non-admin cannot remove anyone', bobRemoveErr?.message || 'NO ERROR');

const { error: selfRemoveErr } = await A.rpc('group_remove_member', { conv_id: group.id, member: aliceId });
check(!!selfRemoveErr, 'the admin cannot remove themselves (leaving is a different thing)',
  selfRemoveErr?.message || 'NO ERROR');

const { error: aliceRemoveErr } = await A.rpc('group_remove_member', { conv_id: group.id, member: carolId() });
check(!aliceRemoveErr, 'the admin can remove a member', aliceRemoveErr?.message || '');

// Leaving, and succession. Alice is the admin; when she goes, bob must inherit
// it — a group whose admin_id points at a non-member can never be administered.
const { error: leaveErr } = await A.rpc('group_leave', { conv_id: group.id });
check(!leaveErr, 'the admin can leave', leaveErr?.message || '');

const { data: afterLeave } = await admin.from('conversations')
  .select('participant_ids, admin_id').eq('id', group.id).single();
check(!(afterLeave?.participant_ids || []).includes(aliceId), 'and is no longer a member');
check(afterLeave?.admin_id === bobId, 'and the remaining member inherited admin',
  `admin_id=${afterLeave?.admin_id}`);

// Last one out deletes the group, rather than leaving an unreachable row.
const { error: bobLeaveErr } = await B.rpc('group_leave', { conv_id: group.id });
check(!bobLeaveErr, 'the last member can leave too', bobLeaveErr?.message || '');
const { data: goneGroup } = await admin.from('conversations').select('id').eq('id', group.id);
check((goneGroup || []).length === 0, 'and the empty group is deleted');

console.log('\n--- 14. MODERATION ---');
// Reports have been written since 0001 and nothing ever read them: no queue, no
// admin, no way to act on one. 0027 is the other half, and the BOUNDARIES are
// what matter most — a moderation surface any signed-in user can reach is worse
// than none, because it looks like oversight while handing out the controls.

const { data: filedReport } = await A.from('reports').insert({
  reporter_id: aliceId,
  reported_id: bobId,
  reported_username: bob,
  reason: 'harassment',
  description: 'e2e moderation fixture',
  status: 'pending',
}).select().single();
check(Boolean(filedReport), 'a user can file a report');

// RLS first, because that is the boundary the routes lean on.
const { data: bobsView } = await B.from('reports').select('id').eq('id', filedReport.id);
check((bobsView || []).length === 0,
  'the person reported cannot see the report about them');

const { data: aliceClosed } = await A.from('reports')
  .update({ status: 'dismissed' }).eq('id', filedReport.id).select();
check((aliceClosed || []).length === 0,
  'and the reporter cannot close their own report');

const { data: sneakyRole } = await A.from('accounts')
  .update({ role: 'admin' }).eq('id', aliceId).select();
check((sneakyRole || []).length === 0 || sneakyRole[0]?.role !== 'admin',
  'a user cannot promote themselves to admin');

// Nobody is an admin yet, so the queue must open for no one.
const queueAsUser = await fetch(APP + '/api/admin/reports?status=pending', {
  headers: { cookie: bobCookie },
});
check(queueAsUser.status === 404,
  'a non-admin gets 404 from the reports queue, not an empty list',
  `status=${queueAsUser.status}`);

const actAsUser = await fetch(APP + '/api/admin/moderate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', cookie: bobCookie },
  body: JSON.stringify({ report_id: filedReport.id, action: 'dismissed' }),
});
check(actAsUser.status === 404, 'and cannot action one either',
  `status=${actAsUser.status}`);

// Now a real moderator. carol is promoted directly, the way the operator would
// be — there is deliberately no in-app way to grant this.
await admin.from('accounts').update({ role: 'admin' }).eq('id', carolId());
const modCookie = await cookieLogin(carol);

const queue = await fetch(APP + '/api/admin/reports?status=pending', {
  headers: { cookie: modCookie },
});
const queueJson = await queue.json().catch(() => null);
check(queue.status === 200, 'an admin can open the queue', `status=${queue.status}`);
check((queueJson?.reports || []).some((r) => r.id === filedReport.id),
  'and the pending report is in it');
check(
  (queueJson?.reports || []).find((r) => r.id === filedReport.id)?.reported?.username === bob,
  'carrying the reported account, so the moderator knows who it is about'
);

// Suspend, and check it actually costs the account something.
const suspend = await fetch(APP + '/api/admin/moderate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', cookie: modCookie },
  body: JSON.stringify({
    report_id: filedReport.id,
    subject_id: bobId,
    action: 'suspended',
    note: 'e2e',
  }),
});
check(suspend.status === 200, 'the admin can suspend the reported account',
  `status=${suspend.status}`);

const { data: afterSuspend } = await admin
  .from('accounts').select('suspended_at').eq('id', bobId).maybeSingle();
check(Boolean(afterSuspend?.suspended_at), 'the account is marked suspended');

const { data: reportAfter } = await admin
  .from('reports').select('status').eq('id', filedReport.id).maybeSingle();
check(reportAfter?.status === 'actioned', 'and the report is closed as actioned',
  `status=${reportAfter?.status}`);

// THE PART THAT MAKES IT REAL. A suspension that does not stop a login is a
// note in a database.
const suspendedLogin = await post('/api/auth/login', { username: bob, password: PW });
check(suspendedLogin.status === 403,
  'a suspended account cannot log in', `status=${suspendedLogin.status}`);
check(/suspended/i.test(suspendedLogin.json?.error || ''),
  'and is told why rather than being shown a wrong-password error',
  suspendedLogin.json?.error);

// Every decision is recorded, including who made it.
const { data: audit } = await admin
  .from('moderation_actions').select('*').eq('subject_id', bobId);
check((audit || []).some((a) => a.action === 'suspended' && a.moderator_id === carolId()),
  'the decision is recorded against the moderator who made it');

// And it can be undone.
const unsuspend = await fetch(APP + '/api/admin/moderate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', cookie: modCookie },
  body: JSON.stringify({ subject_id: bobId, action: 'unsuspended' }),
});
check(unsuspend.status === 200, 'and can unsuspend', `status=${unsuspend.status}`);

const restored = await post('/api/auth/login', { username: bob, password: PW });
check(restored.status === 200, 'after which the account logs in again',
  `status=${restored.status}`);

// An admin suspending themselves would lock the only moderator out with nobody
// left able to undo it.
const selfSuspend = await fetch(APP + '/api/admin/moderate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', cookie: modCookie },
  body: JSON.stringify({ subject_id: carolId(), action: 'suspended' }),
});
check(selfSuspend.status === 400, 'an admin cannot suspend themselves',
  `status=${selfSuspend.status}`);

console.log('\n--- 15. TURN CREDENTIALS ---');
// A TURN relay carries the media of a call, which means it costs bandwidth for
// as long as the call lasts. That makes the credential to use it a spending
// capability, and it is why this endpoint exists at all rather than the app
// shipping a relay password to every browser in a NEXT_PUBLIC_ variable — the
// same shape as the key that had to be rotated on 2026-08-19.
//
// TWO BACKENDS, ONE RESPONSE SHAPE. coturn's `use-auth-secret` mode makes
// short-lived credentials possible without a user database on the relay: the
// username is `<expiry-unix>:<account-id>` and the password is
// base64(HMAC-SHA1(shared-secret, username)), so coturn re-derives the password
// itself and refuses anything past its own expiry. Cloudflare mints its own
// opaque pair through an API instead. `provider` in the response says which
// answered, and the assertions below branch on it.
//
// READ FROM `.env.local`, NOT process.env. This script parses that file itself
// and nothing exports it — so a leak check written against `process.env` passes
// by comparing against undefined, which is worse than no check at all.
const turnSecret = env.TURN_STATIC_AUTH_SECRET || process.env.TURN_STATIC_AUTH_SECRET;
const cfToken = env.CLOUDFLARE_TURN_API_TOKEN || process.env.CLOUDFLARE_TURN_API_TOKEN;

const iceAnon = await fetch(APP + '/api/calls/ice');
check(iceAnon.status === 401, 'the ICE endpoint refuses anyone who is not signed in',
  `status=${iceAnon.status}`);

// CAROL, NOT BOB. §14 suspends bob, and suspending an account revokes its
// sessions — so `bobCookie` is deliberately dead by the time this runs, and
// using it here tests the suspension rather than this endpoint.
const iceRes = await fetch(APP + '/api/calls/ice', { headers: { cookie: modCookie } });
const iceJson = await iceRes.json().catch(() => null);
check(iceRes.status === 200, 'and answers a signed-in caller', `status=${iceRes.status}`);
check(Array.isArray(iceJson?.iceServers) && iceJson.iceServers.length > 0,
  'with at least one ICE server, so calls can still connect either way');

// STUN must be there whether or not a relay is. Without it a browser cannot
// even discover its own public address, and no call connects at all.
const hasStun = (iceJson?.iceServers || []).some((s) =>
  [].concat(s.urls || []).some((u) => String(u).startsWith('stun:'))
);
check(hasStun, 'STUN is always offered, relay or no relay');

// NO SECRET MAY APPEAR IN THE RESPONSE. The shared secret proves the app is
// entitled to mint credentials; handing it out would let anyone mint their own.
const iceBody = JSON.stringify(iceJson || {});
check(!turnSecret || !iceBody.includes(turnSecret),
  'and never the shared secret itself');

const relay = (iceJson?.iceServers || []).find((s) =>
  [].concat(s.urls || []).some((u) => String(u).startsWith('turn:') || String(u).startsWith('turns:'))
);

// `provider` says WHICH backend answered, and the assertions below differ by it
// — a Cloudflare credential is opaque and cannot be recomputed, a coturn one
// must be. Without this the suite would either skip the check that matters or
// fail against a perfectly good relay.
check(['none', 'coturn', 'cloudflare'].includes(iceJson?.provider),
  'the response names which relay backend answered', `provider=${iceJson?.provider}`);
check(Boolean(relay) === (iceJson?.provider !== 'none'),
  'and that name agrees with whether a relay is actually in the list');

if (!relay) {
  // The honest state of this project today, and it is a PASS rather than a
  // skip: STUN-only is the documented fallback, and the assertion that matters
  // is that a missing relay degrades instead of breaking. It also covers the
  // relay provider being DOWN — same degradation, deliberately.
  check(iceRes.status === 200 && hasStun,
    'no relay configured, so STUN-only is served rather than an error (FOLLOWUPS §1)');
} else if (iceJson.provider === 'cloudflare') {
  // Their credentials are opaque — there is no shared secret here and nothing
  // to recompute, so what is checkable is that a usable pair came back.
  check(Boolean(relay.username) && Boolean(relay.credential),
    'the Cloudflare relay carries a username and credential');
  const urls = [].concat(relay.urls || []).map(String);
  check(urls.some((u) => u.startsWith('turns:') && u.includes(':443')),
    'and TURNS on 443, which is the transport that gets through strict firewalls',
    urls.find((u) => u.includes(':443')) || urls[0] || '');
  check(!cfToken || !iceBody.includes(cfToken),
    'and the API token never reaches the browser');
} else {
  const [expiry, accountId] = String(relay.username || '').split(':');
  check(/^\d+$/.test(expiry) && Number(expiry) * 1000 > Date.now(),
    'the relay username carries an expiry in the future', relay.username);
  check(accountId === carolId(),
    'and names the account it was minted for, so abuse is attributable');
  check(Number(expiry) * 1000 - Date.now() < 24 * 60 * 60 * 1000,
    'and expires within a day rather than lasting forever');

  // Recomputed here rather than trusted. If this does not match, coturn will
  // reject the credential too, and the call fails with no explanation.
  if (turnSecret) {
    const { createHmac } = await import('node:crypto');
    const expected = createHmac('sha1', turnSecret)
      .update(relay.username)
      .digest('base64');
    check(relay.credential === expected,
      'and the password is a correct HMAC of it, which is what coturn checks');
  }
}

console.log('\n--- 16. AUTHENTICATING WITH A BEARER TOKEN ---');
// WHY THIS EXISTS: the native app cannot use the session cookie.
//
// Once the client is bundled into the app it runs from `capacitor://localhost`,
// so a cookie for calamus3.vercel.app is third-party — and WKWebView blocks
// those outright. It is not a setting that can be loosened. Every route that
// authenticates therefore has to accept `Authorization: Bearer <access_token>`
// as well as the cookie.
//
// ADDITIVE ON PURPOSE. The cookie path is asserted below too, because the web
// app still uses it and a regression there would take out every signed-in
// screen at once.
const bearerFor = async (username) => {
  const c = await signedInClient(username);
  const { data } = await c.auth.getSession();
  return data?.session?.access_token;
};

const aliceToken = await bearerFor(alice);
const carolToken = await bearerFor(carol);

const iceWith = (headers) => fetch(APP + '/api/calls/ice', { headers });

const bearerOnly = await iceWith({ Authorization: `Bearer ${carolToken}` });
check(bearerOnly.status === 200,
  'a bearer token alone authenticates, with no cookie at all',
  `status=${bearerOnly.status}`);

const cookieOnly = await iceWith({ cookie: modCookie });
check(cookieOnly.status === 200,
  'and the cookie still works, because the web app depends on it',
  `status=${cookieOnly.status}`);

const noAuth = await iceWith({});
check(noAuth.status === 401, 'while neither is still refused', `status=${noAuth.status}`);

const garbage = await iceWith({ Authorization: 'Bearer not.a.real.jwt' });
check(garbage.status === 401,
  'a malformed token is refused rather than ignored into an anonymous pass',
  `status=${garbage.status}`);

// A token that is merely ABSENT from the header must not fall through to some
// ambient session — "Bearer" with nothing after it is a client bug, not a login.
const emptyBearer = await iceWith({ Authorization: 'Bearer ' });
check(emptyBearer.status === 401, 'and so is an empty one', `status=${emptyBearer.status}`);

// IDENTITY, NOT JUST VALIDITY. A route that reads `auth.uid()` must see the
// account the TOKEN names — carol is the moderator (promoted in §14), alice is
// not. If the bearer were being ignored in favour of anything else, these two
// would not differ.
const asMod = await fetch(APP + '/api/admin/reports?status=pending', {
  headers: { Authorization: `Bearer ${carolToken}` },
});
check(asMod.status === 200,
  'the moderator queue opens for a bearer belonging to the moderator',
  `status=${asMod.status}`);

const asUser = await fetch(APP + '/api/admin/reports?status=pending', {
  headers: { Authorization: `Bearer ${aliceToken}` },
});
check(asUser.status !== 200,
  'and not for a bearer belonging to someone else',
  `status=${asUser.status}`);

// WHERE THE NATIVE CLIENT GETS ITS TOKEN FROM.
//
// It cannot read the session cookie this route sets, so it asks for the tokens
// in the body instead. Gated on a flag so the web response — which has the
// cookie and no use for them — carries no token at all.
const plainLogin = await post('/api/auth/login', {
  username: carol, password: PW, device_fingerprint: FP,
});
check(plainLogin.status === 200 && !plainLogin.json?.session,
  'login returns no tokens to a caller that did not ask',
  `status=${plainLogin.status} session=${plainLogin.json?.session ? 'present' : 'absent'}`);

const nativeLogin = await post('/api/auth/login', {
  username: carol, password: PW, device_fingerprint: FP, want_session: true,
});
const handedToken = nativeLogin.json?.session?.access_token;
check(Boolean(handedToken) && Boolean(nativeLogin.json?.session?.refresh_token),
  'and both tokens when it does — a refresh token too, or the app signs out in an hour',
  `status=${nativeLogin.status}`);

if (handedToken) {
  const usingHanded = await iceWith({ Authorization: `Bearer ${handedToken}` });
  check(usingHanded.status === 200,
    'and the token it hands back actually authenticates',
    `status=${usingHanded.status}`);
}

// LOGGING OUT MUST CLEAR THE COOKIE EVEN WHEN THE CALLER USED A BEARER.
//
// `auth.signOut()` clears the storage ITS OWN client was built on. Once a
// bearer wins over the cookie, a browser sending both would have its token
// revoked and its cookie left intact — logged out, still signed in, silently.
// The route clears the cookie explicitly for that reason; this is the guard.
//
// Asserted on the Set-Cookie header rather than by re-using the old cookie,
// because the access token inside it stays cryptographically valid until it
// expires — revoking a session does not un-sign a JWT. That is the same
// caveat KNOWN-ISSUES records about suspension.
const loggedOut = await fetch(APP + '/api/auth/logout', {
  method: 'POST',
  headers: { Authorization: `Bearer ${carolToken}`, cookie: modCookie },
});
const setCookies = loggedOut.headers.getSetCookie?.() || [];
const clearsSession = setCookies.some(
  (c) => /^sb-/i.test(c) && (/max-age=0/i.test(c) || /expires=thu, 01 jan 1970/i.test(c))
);
check(loggedOut.status === 200, 'logging out with a bearer succeeds',
  `status=${loggedOut.status}`);
check(clearsSession,
  'and still clears the session cookie, rather than logging out only the token',
  setCookies.length ? setCookies.map((c) => c.split(';')[0].split('=')[0]).join(', ') : 'no Set-Cookie at all');

console.log('\n--- 17. CORS FOR THE BUNDLED APP ---');
// The bundled client calls this API from `capacitor://localhost` (iOS) or
// `https://localhost` (Android). Without a matching Access-Control-Allow-Origin
// the WebView refuses the response before any app code sees it: the request
// succeeds on the server and the app shows a network error.
//
// `Authorization` is not a CORS-safelisted request header, so every call
// carrying a bearer token is preflighted — which is why OPTIONS has to be
// answered rather than left to a route handler that would 405 it.
const NATIVE_ORIGIN = 'capacitor://localhost';

const preflight = await fetch(APP + '/api/calls/ice', {
  method: 'OPTIONS',
  headers: {
    Origin: NATIVE_ORIGIN,
    'Access-Control-Request-Method': 'GET',
    'Access-Control-Request-Headers': 'authorization',
  },
});
check(preflight.status === 204 || preflight.status === 200,
  'a preflight from the app origin is answered, not 405d',
  `status=${preflight.status}`);
check(preflight.headers.get('access-control-allow-origin') === NATIVE_ORIGIN,
  'and names that exact origin back',
  preflight.headers.get('access-control-allow-origin') || 'no header');
check(/authorization/i.test(preflight.headers.get('access-control-allow-headers') || ''),
  'and permits the Authorization header, without which the token cannot be sent',
  preflight.headers.get('access-control-allow-headers') || 'no header');

// The real request, with the token, as the app would send it.
const corsReal = await fetch(APP + '/api/calls/ice', {
  headers: { Origin: NATIVE_ORIGIN, Authorization: `Bearer ${aliceToken}` },
});
check(corsReal.status === 200 && corsReal.headers.get('access-control-allow-origin') === NATIVE_ORIGIN,
  'and the real request comes back readable by that origin',
  `status=${corsReal.status} allow-origin=${corsReal.headers.get('access-control-allow-origin')}`);

// A WILDCARD WOULD PASS EVERY ASSERTION ABOVE. This is the one that says the
// allowlist is real: some other site must NOT be handed permission.
const stranger = await fetch(APP + '/api/calls/ice', {
  headers: { Origin: 'https://evil.example', Authorization: `Bearer ${aliceToken}` },
});
check(!stranger.headers.get('access-control-allow-origin'),
  'while an origin that is not on the list gets no permission at all',
  stranger.headers.get('access-control-allow-origin') || 'no header (correct)');

// And the web app, which shares an origin and needs none of this, is untouched.
const sameOrigin = await fetch(APP + '/api/calls/ice', {
  headers: { Authorization: `Bearer ${aliceToken}` },
});
check(sameOrigin.status === 200, 'a same-origin call is unaffected', `status=${sameOrigin.status}`);

console.log(`\n=========== ${pass} passed, ${fail} failed ===========\n`);



// cleanup
//
// Conversations FIRST. `participant_ids` is a uuid[] with no foreign key, so a
// conversation does not cascade when its members are deleted — every run of
// this suite until now has left its conversations (and their messages) behind
// permanently, because deleting the users removed the only thing pointing at
// them. Deleting the conversation cascades its messages.
const testIds = [aliceId, bobId, rC.json.account.id];
const { data: allConvs } = await admin.from('conversations').select('id, participant_ids');
const strays = (allConvs || []).filter((c) =>
  (c.participant_ids || []).some((p) => testIds.includes(p))
);
for (const c of strays) await admin.from('conversations').delete().eq('id', c.id);

for (const id of testIds) {
  await admin.auth.admin.deleteUser(id).catch(() => {});
}
console.log(`test users deleted (${testIds.length}), conversations removed (${strays.length})`);
process.exit(fail ? 1 : 0);
