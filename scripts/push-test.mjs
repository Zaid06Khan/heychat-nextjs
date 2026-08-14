/**
 * Sends a test notification straight to a user's registered devices.
 *
 *     node scripts/push-test.mjs <username> [message]
 *
 * WHY THIS EXISTS. When a notification doesn't arrive there are four different
 * things that could be wrong, and from the outside they look identical:
 *
 *   1. the browser never subscribed (no permission, no service worker, no keys)
 *   2. the subscription never reached the database
 *   3. Web Push delivery itself is broken (bad VAPID keys, dead endpoint)
 *   4. notifyForMessage() decided not to send — a mute, a block, or a preview
 *      preference
 *
 * This script exercises 1-3 and deliberately skips 4. If a test notification
 * arrives but a real message doesn't, the fault is in that decision, since
 * sending and notifying are now one request and there is no longer a delivery
 * step in between that can be missed. If neither arrives, the problem is
 * further down and this will say where.
 *
 * Reads .env.local directly and uses the service role, so it needs no running
 * dev server.
 */
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const username = process.argv[2];
const messageText = process.argv[3] || 'If you can read this, push is working.';

if (!username) {
  console.error('Usage: node scripts/push-test.mjs <username> [message]');
  process.exit(1);
}

if (!env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
  console.error('No VAPID keys in .env.local. Run: npm run push:keys');
  process.exit(1);
}

webpush.setVapidDetails(
  env.VAPID_SUBJECT || 'mailto:admin@heychat.invalid',
  env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  env.VAPID_PRIVATE_KEY
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: account, error: accErr } = await admin
  .from('accounts')
  .select('id, username, display_name')
  .eq('username', username)
  .maybeSingle();

if (accErr) {
  console.error('Could not look up that account:', accErr.message);
  process.exit(1);
}
if (!account) {
  console.error(`No account called "${username}".`);
  process.exit(1);
}

const { data: subs, error: subErr } = await admin
  .from('push_subscriptions')
  .select('id, endpoint, p256dh, auth, created_date, last_success_at')
  .eq('account_id', account.id);

if (subErr) {
  console.error('Could not read subscriptions:', subErr.message);
  console.error('If this says the table does not exist, apply 0008_push_subscriptions.sql.');
  process.exit(1);
}

if (!subs?.length) {
  console.log(`
${account.username} has no registered devices.

That means the browser never subscribed, or the subscription never reached the
server. In the app: Settings -> Notifications -> Turn on, and check the browser
actually prompted for permission. Then run this again.
`);
  process.exit(1);
}

console.log(`\n${account.username} has ${subs.length} registered device(s).\n`);

let delivered = 0;

for (const sub of subs) {
  // Shows which browser each row is, without printing the whole endpoint —
  // the tail is the unguessable part and is effectively a credential.
  const label = new URL(sub.endpoint).host;
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({
        title: 'HeyChat test',
        body: messageText,
        url: '/home',
        timestamp: Date.now(),
      })
    );
    delivered += 1;
    console.log(`  OK       ${label}  (registered ${sub.created_date?.slice(0, 10)})`);
  } catch (err) {
    const code = err?.statusCode;
    if (code === 404 || code === 410) {
      console.log(`  DEAD     ${label}  -- endpoint expired, removing`);
      await admin.from('push_subscriptions').delete().eq('id', sub.id);
    } else if (code === 403) {
      console.log(`  REJECTED ${label}  -- VAPID key mismatch.`);
      console.log('           The keys in .env.local are not the ones this device subscribed with.');
      console.log('           Turn notifications off and on again in Settings to re-subscribe.');
    } else {
      console.log(`  FAILED   ${label}  -- ${code || ''} ${err?.body || err?.message || ''}`.trim());
    }
  }
}

console.log(`\n${delivered} of ${subs.length} delivered.\n`);

if (delivered > 0) {
  console.log(`Nothing showed up on screen? The push reached the browser, so the
remaining suspects are the service worker itself (DevTools -> Application ->
Service Workers) or the OS suppressing notifications -- on Windows, check Focus
Assist / Do Not Disturb.\n`);
}
