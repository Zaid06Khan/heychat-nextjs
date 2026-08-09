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

const notify = async (cookie, body) => {
  const res = await fetch(APP + '/api/push/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

// The notify route's whole job is refusing to buzz people on request. Reading a
// message is not permission to notify about it, and being nobody in particular
// is not permission to do anything.
const carolNotify = await notify(carolCookie, { messageId: mediaMsg.id });
check(carolNotify.status === 404, 'a non-participant cannot trigger a notification',
  `status=${carolNotify.status}`);

const bobNotify = await notify(bobCookie, { messageId: mediaMsg.id });
check(bobNotify.status === 404, 'a participant cannot notify about someone else\'s message',
  `status=${bobNotify.status}`);

const anonNotify = await notify('', { messageId: mediaMsg.id });
check(anonNotify.status === 401, 'notifying requires a session', `status=${anonNotify.status}`);

// Freshness, tested properly: a message bob really did send, backdated past the
// route's one-minute window. He passes every other check, so this isolates the
// replay guard. Written with the service role because created_date is what is
// being controlled here. (Bob, not alice — alice is near the login limit and
// has no cookie in this run.)
const { data: oldMsg } = await admin.from('messages')
  .insert({
    conversation_id: conv.id, sender_id: bobId, content: 'sent a while ago',
    message_type: 'text', read_by: [bobId],
    created_date: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  })
  .select().single();

const staleNotify = await notify(bobCookie, { messageId: oldMsg?.id });
check(staleNotify.status === 200 && staleNotify.json?.reason === 'stale',
  'the sender cannot replay an old message to buzz someone again',
  `status=${staleNotify.status} reason=${staleNotify.json?.reason}`);

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
await A.from('messages')
  .update({ deleted_at: new Date().toISOString(), content: null, media_url: null })
  .eq('id', toDelete.id);
const { data: afterDelete } = await B.from('messages').select('content, deleted_at').eq('id', toDelete.id).single();
check(!!afterDelete?.deleted_at && afterDelete.content === null,
  'a deleted message keeps no readable body', `content=${JSON.stringify(afterDelete?.content)}`);

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

await A.from('messages')
  .update({ deleted_at: new Date().toISOString(), content: null, media_url: null })
  .eq('id', mediaMsgToDelete.id);

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

console.log(`\n=========== ${pass} passed, ${fail} failed ===========\n`);

// cleanup
for (const id of [aliceId, bobId, rC.json.account.id]) {
  await admin.auth.admin.deleteUser(id).catch(() => {});
}
console.log('test users deleted');
process.exit(fail ? 1 : 0);
