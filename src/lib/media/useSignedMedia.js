'use client';

import { useEffect, useState } from 'react';

/**
 * Resolves a private storage object to a short-lived signed URL.
 *
 * Since 0006 the media bucket has no read policy, so `media_url` and `avatar`
 * are no longer things a browser can render directly — each one has to be
 * exchanged for a signed URL first.
 *
 * Results are cached per key for slightly less than the URL's lifetime, and
 * in-flight requests are shared, so a conversation with twenty photos makes
 * twenty requests rather than twenty per re-render, and none at all on scroll.
 */

const cache = new Map(); // cacheKey -> { url, expiresAt }
const inflight = new Map(); // cacheKey -> Promise<string|null>

// Refresh a little before the server's TTL so an image never renders against a
// URL that expires mid-request.
const SAFETY_MARGIN_MS = 5 * 60 * 1000;

async function fetchSigned(cacheKey, payload) {
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.url;

  if (inflight.has(cacheKey)) return inflight.get(cacheKey);

  const promise = (async () => {
    try {
      const res = await fetch('/api/media/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return null;
      const { url, expiresIn } = await res.json();
      cache.set(cacheKey, {
        url,
        expiresAt: Date.now() + Math.max(expiresIn * 1000 - SAFETY_MARGIN_MS, 30_000),
      });
      return url;
    } catch {
      return null;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, promise);
  return promise;
}

/**
 * @param {{ messageId?: string, key?: string }} target
 * @returns {{ url: string|null, loading: boolean, failed: boolean }}
 */
export function useSignedMedia(target) {
  const messageId = target?.messageId || null;
  const key = target?.key || null;
  const cacheKey = messageId ? `m:${messageId}` : key ? `k:${key}` : null;

  const [state, setState] = useState(() => {
    const hit = cacheKey && cache.get(cacheKey);
    return hit && hit.expiresAt > Date.now()
      ? { url: hit.url, loading: false, failed: false }
      : { url: null, loading: Boolean(cacheKey), failed: false };
  });

  useEffect(() => {
    if (!cacheKey) {
      setState({ url: null, loading: false, failed: false });
      return;
    }

    const hit = cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      setState({ url: hit.url, loading: false, failed: false });
      return;
    }

    let cancelled = false;
    setState({ url: null, loading: true, failed: false });

    fetchSigned(cacheKey, messageId ? { messageId } : { key }).then((url) => {
      if (cancelled) return;
      setState({ url, loading: false, failed: !url });
    });

    return () => { cancelled = true; };
  }, [cacheKey, messageId, key]);

  return state;
}
