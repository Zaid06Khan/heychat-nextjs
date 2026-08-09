'use client';

/**
 * Browser half of Web Push.
 *
 * Three separate things have to line up before a notification can arrive, and
 * they fail independently, which is why `getPushState()` reports them
 * separately rather than as one boolean:
 *
 *   1. The browser supports service workers, push and notifications at all.
 *   2. The user has granted the notification permission.
 *   3. This browser holds a live subscription that the server also knows about.
 *
 * The source of truth for (3) is the browser, not the database — the app asks
 * its own service worker via pushManager.getSubscription(). That is why
 * push_subscriptions needs no read policy for clients (see 0008).
 */

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

export function isPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Push cannot work without a key to identify the application server. */
export function isPushConfigured() {
  return Boolean(VAPID_PUBLIC_KEY);
}

/**
 * The applicationServerKey has to be raw bytes, but VAPID keys travel as
 * URL-safe base64. Browsers do not do this conversion for you.
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

let registrationPromise = null;

/**
 * Registers the worker once per page load. Repeated register() calls for the
 * same script are harmless but each returns a fresh promise, and callers want
 * the same registration.
 */
export function getServiceWorkerRegistration() {
  if (!isPushSupported()) return Promise.resolve(null);
  if (!registrationPromise) {
    registrationPromise = navigator.serviceWorker
      .register('/sw.js')
      .then(() => navigator.serviceWorker.ready)
      .catch((err) => {
        // Registration fails on insecure origins and when the file 404s. Neither
        // should take the app down — it just means no notifications.
        console.warn('[push] service worker registration failed', err);
        registrationPromise = null;
        return null;
      });
  }
  return registrationPromise;
}

/**
 * @returns {Promise<{ supported: boolean, configured: boolean,
 *                     permission: NotificationPermission | 'unsupported',
 *                     subscribed: boolean }>}
 */
export async function getPushState() {
  if (!isPushSupported()) {
    return { supported: false, configured: isPushConfigured(), permission: 'unsupported', subscribed: false };
  }

  const permission = Notification.permission;
  let subscribed = false;

  // Only worth asking when permission is granted; otherwise there cannot be a
  // subscription and waiting on serviceWorker.ready would hang on a browser
  // that never registered one.
  if (permission === 'granted') {
    const registration = await getServiceWorkerRegistration();
    if (registration) {
      subscribed = Boolean(await registration.pushManager.getSubscription());
    }
  }

  return { supported: true, configured: isPushConfigured(), permission, subscribed };
}

async function postJson(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Request failed');
  }
  return res.json().catch(() => ({}));
}

/**
 * Asks for permission if it has not been given, then subscribes and registers
 * that subscription with the server.
 *
 * Must be called from a user gesture. Browsers reject a permission prompt that
 * did not come from a click, and Chrome permanently blocks origins that ask on
 * page load — which is exactly why this is wired to a Settings toggle rather
 * than fired on startup.
 *
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function enablePush() {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' };
  if (!isPushConfigured()) return { ok: false, reason: 'not-configured' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: permission };

  const registration = await getServiceWorkerRegistration();
  if (!registration) return { ok: false, reason: 'no-service-worker' };

  // An existing subscription is reused. Calling subscribe() again with the same
  // key returns the same subscription, but only if userVisibleOnly matches —
  // mismatches throw, so both call sites must agree.
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      // Required to be true by every browser that ships push: the platform
      // demands that a push results in something the user can see.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  await postJson('/api/push/subscribe', subscription.toJSON());
  return { ok: true };
}

/**
 * Drops the browser's subscription first, then the server's record. In that
 * order deliberately: if the second step fails, the server is left pushing to a
 * dead endpoint, which it prunes on the first 410. The reverse order would
 * leave a live subscription nobody remembers — silent, undeletable buzzing.
 */
export async function disablePush() {
  if (!isPushSupported()) return { ok: true };

  const registration = await getServiceWorkerRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  const endpoint = subscription?.endpoint;

  if (subscription) await subscription.unsubscribe().catch(() => {});

  try {
    await postJson('/api/push/unsubscribe', endpoint ? { endpoint } : { all: true });
  } catch {
    // The local subscription is already gone, which is what the user asked for.
    // The server row will be pruned when the next send returns 410.
  }

  return { ok: true };
}

/**
 * Re-asserts an existing subscription on app start.
 *
 * Never prompts — it returns immediately unless permission was already granted,
 * so it is safe to call on every load. It exists because subscriptions expire
 * and get rotated by the push service, and a device whose subscription lapsed
 * stops receiving messages with no visible sign that anything is wrong.
 */
export async function syncPushSubscription() {
  if (!isPushSupported() || !isPushConfigured()) return;
  if (Notification.permission !== 'granted') return;

  try {
    const registration = await getServiceWorkerRegistration();
    if (!registration) return;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      // Permission is granted but the subscription is gone — the usual cause is
      // the push service rotating it. Re-subscribing here is silent and needs
      // no gesture, because the permission prompt is not involved.
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    await postJson('/api/push/subscribe', subscription.toJSON());
  } catch (err) {
    console.warn('[push] could not sync subscription', err);
  }
}

/**
 * Fire-and-forget notification request for a message that was just sent.
 *
 * Deliberately swallows everything. A failed notification must never surface as
 * a failed send — the message is already in the database by this point.
 */
export function requestPushForMessage(messageId) {
  if (!messageId || typeof fetch === 'undefined') return;
  fetch('/api/push/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageId }),
    keepalive: true,
  }).catch(() => {});
}
