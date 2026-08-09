/* eslint-disable no-undef */
/**
 * HeyChat service worker — notifications only.
 *
 * Deliberately NOT an offline cache. Caching a messaging app's shell is easy to
 * get wrong in a way that serves users a stale build for weeks, and offline
 * support was never the point: the point is finding out that a message arrived
 * while the app was closed. Adding a caching strategy later is a separate,
 * reversible decision. See FOLLOWUPS.md.
 *
 * This file is served from /sw.js so its scope is the whole origin. It is plain
 * ES5-ish JavaScript with no imports because it is shipped verbatim out of
 * public/ and never passes through the bundler.
 */

// Take over as soon as a new version is installed instead of waiting for every
// tab to close. A notification worker has no in-flight page state to corrupt,
// and the alternative is shipping a fix that reaches nobody until they quit the
// app — which, for an installed PWA, can be never.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  // A push with no payload is legal and some services send one to wake the
  // worker. Show something honest rather than nothing at all, since the
  // notification permission has already been spent by the time we get here.
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }

  const title = payload.title || 'HeyChat';
  const conversationId = payload.conversationId || null;

  event.waitUntil(showUnlessAlreadyLooking(title, payload, conversationId));
});

/**
 * Suppresses the notification when the user is demonstrably already reading
 * that exact conversation — a notification for the window you are typing into
 * is pure noise.
 *
 * The tradeoff is real and worth stating: a push handler that resolves without
 * showing anything can make Chrome display its own "this site was updated in
 * the background" notice, and repeated offences cost the origin its push
 * budget. It is accepted here because the condition is narrow — a visible,
 * focused tab sitting on that one conversation — so across all pushes the app
 * sends, the overwhelming majority still result in a visible notification.
 */
async function showUnlessAlreadyLooking(title, payload, conversationId) {
  if (conversationId) {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const watching = clientList.some(
      (client) =>
        client.visibilityState === 'visible' &&
        client.focused &&
        client.url.includes(`/chat/${conversationId}`)
    );
    if (watching) return;
  }

  return self.registration.showNotification(title, {
    body: payload.body || 'New message',
    // Same tag = same conversation, so a burst of messages replaces one
    // notification instead of stacking ten. `renotify` still buzzes for each.
    tag: conversationId ? `conv:${conversationId}` : 'heychat',
    renotify: true,
    // The app icon, as the same SVG the manifest uses. Support for SVG
    // notification icons is uneven; where it is missing the platform falls back
    // to the installed PWA's icon or its own default, which is why this is not
    // worth maintaining a set of rasterised PNGs for.
    icon: '/icon.svg',
    timestamp: payload.timestamp || Date.now(),
    data: { url: payload.url || (conversationId ? `/chat/${conversationId}` : '/home') },
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const target = (event.notification.data && event.notification.data.url) || '/home';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Prefer waking a tab that is already open. Opening a second window onto
      // an app the user already has running is the classic web-push annoyance.
      for (const client of clientList) {
        if ('focus' in client) {
          // The app is a client-side router, so navigate() beats openWindow():
          // it reuses the loaded bundle instead of a cold start.
          if ('navigate' in client) {
            return client.focus().then((focused) => focused.navigate(target).catch(() => focused));
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

/**
 * Push services rotate subscriptions on their own schedule — key rotation,
 * long inactivity, browser data clearing. When that happens the old endpoint
 * stops working and the browser fires this instead.
 *
 * Re-subscribing here needs the VAPID public key, which this file cannot import
 * and must not hardcode (it changes per deployment). So the worker records that
 * it happened and the page re-subscribes on its next load, where the key is
 * available. Until then that device silently gets no notifications — an honest
 * limitation, and the reason the app re-asserts its subscription on every
 * startup rather than trusting that one succeeded once.
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' });
      }
    })
  );
});
