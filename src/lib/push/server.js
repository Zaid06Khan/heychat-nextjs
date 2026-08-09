import 'server-only';
import webpush from 'web-push';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

/**
 * Web Push delivery.
 *
 * VAPID ("Voluntary Application Server Identification") is how a push service
 * knows the notification really came from this app. The keypair is generated
 * once per deployment with `npm run push:keys`; the public half is safe in the
 * browser (it is literally handed to the push service by the subscribing
 * client), the private half signs and must never leave the server.
 */

let configured = false;

/**
 * Configured lazily rather than at import time. `web-push` throws if handed an
 * invalid key, and doing that at module scope would take down every route that
 * transitively imports this file — including ones that never send a push.
 * Failing here instead keeps a missing key to a broken feature, not a broken app.
 *
 * @returns {boolean} whether push is configured at all
 */
function ensureConfigured() {
  if (configured) return true;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;

  webpush.setVapidDetails(
    // Push services want a way to contact whoever operates the app if it starts
    // behaving badly. mailto: is the conventional answer; the value is never
    // shown to users.
    process.env.VAPID_SUBJECT || 'mailto:admin@heychat.invalid',
    publicKey,
    privateKey
  );
  configured = true;
  return true;
}

export function isPushConfigured() {
  return ensureConfigured();
}

/**
 * Deliver one payload to every device belonging to `accountIds`.
 *
 * Uses the service role, because push_subscriptions has no policy or grant for
 * `authenticated` at all (0008). Callers are responsible for having decided
 * that these accounts are entitled to this notification — this function does no
 * authorisation of its own.
 *
 * Never throws. A notification that cannot be delivered must not fail the
 * message that triggered it: the message is the product, the notification is a
 * courtesy.
 *
 * @returns {Promise<{ sent: number, failed: number, pruned: number, skipped?: string }>}
 */
export async function sendPushToAccounts(accountIds, payload) {
  if (!ensureConfigured()) return { sent: 0, failed: 0, pruned: 0, skipped: 'not-configured' };

  const ids = [...new Set((accountIds || []).filter(Boolean))];
  if (ids.length === 0) return { sent: 0, failed: 0, pruned: 0 };

  const admin = getSupabaseAdminClient();
  const { data: subs, error } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .in('account_id', ids);

  if (error || !subs?.length) return { sent: 0, failed: 0, pruned: 0 };

  const body = JSON.stringify(payload);
  const dead = [];
  const delivered = [];
  let failed = 0;

  // Fan out in parallel. These are independent HTTPS calls to third-party push
  // services and one slow endpoint should not hold up the rest.
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          { TTL: 60 * 60 * 24 }
        );
        delivered.push(sub.id);
      } catch (err) {
        // 404/410 mean the subscription is permanently gone — the browser was
        // uninstalled, the user cleared site data, the endpoint was rotated.
        // These never recover, and left in place they would be retried on every
        // single message forever.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          dead.push(sub.id);
        } else {
          failed += 1;
        }
      }
    })
  );

  if (dead.length > 0) {
    await admin.from('push_subscriptions').delete().in('id', dead);
  }

  if (delivered.length > 0) {
    // Liveness marker for the endpoints that actually took the message —
    // deliberately not the soft-failed ones, or failure_count would reset to
    // zero on every send and a permanently sick endpoint would never show up.
    await admin
      .from('push_subscriptions')
      .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
      .in('id', delivered);
  }

  return { sent: delivered.length, failed, pruned: dead.length };
}
