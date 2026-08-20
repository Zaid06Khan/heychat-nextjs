'use client';

/**
 * Where the browser looks to find a route to the other person.
 *
 * TWO KINDS OF SERVER, and the difference is the whole cost story.
 *
 * STUN just tells a browser what its own public address looks like from
 * outside. It handles no media, costs essentially nothing, and Google runs a
 * free one that everybody uses. For most pairs of people that is enough: they
 * discover each other's addresses and connect directly.
 *
 * TURN *relays the media* when a direct connection is impossible — symmetric
 * NAT, strict corporate firewalls, some mobile carriers. Roughly 15-20% of
 * connections need it, and because it carries the media it costs bandwidth for
 * as long as the call lasts. That is why it is self-hosted here rather than
 * bought per-minute. `docs/TURN.md` is the runbook.
 *
 * THE CREDENTIAL IS FETCHED, NOT BUILT IN. Until 2026-08-20 this module read
 * `NEXT_PUBLIC_TURN_URL/USERNAME/CREDENTIAL`, which put a fixed relay password
 * in every browser bundle — a licence to spend bandwidth, published to anyone
 * who opened devtools, revocable only by changing it for everybody at once.
 * `GET /api/calls/ice` mints one that expires on its own; the shared secret
 * never leaves the server.
 *
 * DELIBERATELY OPTIONAL, STILL. With no relay configured the endpoint answers
 * with STUN alone, and so does this module if the endpoint cannot be reached at
 * all. Calls keep working for the majority who can connect directly and fail
 * for the minority who cannot — which is what makes it possible to build and
 * test this before the relay exists.
 */

const STUN_ONLY = [{ urls: 'stun:stun.l.google.com:19302' }];

/** The last answer, and when it stops being usable. */
let cached = null;
/**
 * One in-flight fetch, shared. Two people can start and answer a call within
 * the same second, and `newPeerConnection()` runs on both paths — without this
 * they each fetch, and the second credential silently replaces the first in the
 * cache while the first connection is still using it.
 */
let inFlight = null;
/** What the last successful fetch actually contained. See hasTurn(). */
let relayConfigured = false;

/** Refresh a little early: a credential that expires mid-handshake is useless. */
const REFRESH_MARGIN_MS = 60 * 1000;

async function fetchIceConfig() {
  const res = await fetch('/api/calls/ice', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`ice: HTTP ${res.status}`);
  const body = await res.json();

  const iceServers = Array.isArray(body?.iceServers) && body.iceServers.length
    ? body.iceServers
    : STUN_ONLY;

  // `ttl` is a duration, not a timestamp, so a device with a wrong clock still
  // caches for the right length of time.
  const ttlMs = Number(body?.ttl) > 0 ? Number(body.ttl) * 1000 : null;

  relayConfigured = Boolean(body?.relay);
  cached = {
    iceServers,
    // With no relay there is no credential to expire, so the answer is good
    // until the page goes away.
    expiresAt: ttlMs ? Date.now() + ttlMs - REFRESH_MARGIN_MS : Infinity,
  };
  return cached.iceServers;
}

/**
 * @returns {Promise<RTCConfiguration>}
 */
export async function getIceConfig() {
  if (cached && Date.now() < cached.expiresAt) {
    return { iceServers: cached.iceServers };
  }

  if (!inFlight) {
    inFlight = fetchIceConfig()
      .catch((e) => {
        // NEVER THROW. A call with STUN alone connects for most people; a call
        // that could not start because the credential endpoint was down
        // connects for nobody. The relay is an improvement to fall back FROM.
        console.warn('[calls] could not fetch ICE configuration:', e.message);
        relayConfigured = false;
        cached = null;
        return STUN_ONLY;
      })
      .finally(() => { inFlight = null; });
  }

  return { iceServers: await inFlight };
}

/**
 * Whether a relay is actually configured, for honest UI when a call fails.
 *
 * READS WHAT THE SERVER SAID, not what the browser was built with. It used to
 * test three `NEXT_PUBLIC_` variables, which answered "were these set at build
 * time" — a different question from "is there a relay", and the wrong one to
 * put behind a message explaining why a call would not connect.
 *
 * Sync, because `CallBar` asks during render, and false until the first call
 * has fetched — which is the safe direction: it offers the explanation only
 * once it knows there is genuinely no relay.
 */
export function hasTurn() {
  return relayConfigured;
}
