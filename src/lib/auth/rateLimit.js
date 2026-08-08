import 'server-only';

/**
 * Rate limiting for the unauthenticated auth routes.
 *
 * WHAT THIS IS: an in-process sliding-window counter. No dependencies, no
 * database, no Redis.
 *
 * WHAT IT IS NOT: shared state. The counters live in the memory of one server
 * process, so if the app is ever running on several instances, an attacker gets
 * the limit *per instance* rather than overall. On a single self-hosted server
 * that is exact; on Vercel's Fluid Compute, instances are reused across requests
 * so it still bites hard, just not precisely.
 *
 * That is a deliberate trade: it turns "unlimited password guesses" into "a few
 * per minute" with nothing new to run or pay for. When this app needs to be
 * correct across instances, swap the store for Upstash Redis or a Postgres
 * table — the check() signature is designed not to change.
 *
 * Supabase Auth has its own limits underneath this, but they are generous and
 * are not aimed at username harvesting.
 */

const buckets = new Map();

// Stop the Map growing without bound on a long-lived process.
const SWEEP_EVERY_MS = 5 * 60 * 1000;
let lastSweep = Date.now();

function sweep(now) {
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  for (const [key, hits] of buckets) {
    const live = hits.filter((t) => t > now - 60 * 60 * 1000);
    if (live.length === 0) buckets.delete(key);
    else buckets.set(key, live);
  }
}

/**
 * @returns {{ ok: true } | { ok: false, retryAfter: number }} seconds to wait
 */
export function check(key, limit, windowMs) {
  const now = Date.now();
  sweep(now);

  const cutoff = now - windowMs;
  const hits = (buckets.get(key) || []).filter((t) => t > cutoff);

  if (hits.length >= limit) {
    const retryAfter = Math.ceil((hits[0] + windowMs - now) / 1000);
    return { ok: false, retryAfter: Math.max(retryAfter, 1) };
  }

  hits.push(now);
  buckets.set(key, hits);
  return { ok: true };
}

/**
 * Best-effort client address.
 *
 * These headers are trivially forged by anyone talking to the origin directly,
 * so this is only meaningful behind a proxy that overwrites them (Vercel and
 * most reverse proxies do). Treat it as friction, not identity.
 */
export function clientKey(request) {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

export function tooManyRequests(retryAfter, message) {
  return Response.json(
    { error: message || `Too many attempts. Try again in ${retryAfter}s.` },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  );
}
