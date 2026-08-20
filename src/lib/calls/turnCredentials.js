import 'server-only';
import { createHmac } from 'node:crypto';

/**
 * Short-lived credentials for a TURN relay.
 *
 * The `server-only` import makes the build fail if this file ever reaches a
 * client bundle — the same guard `lib/supabase/admin.js` uses. It holds no
 * secret itself (the route passes one in), but the whole point of the exercise
 * is that credential minting happens where the browser cannot see it, and a
 * silent import from a component would quietly undo that.
 *
 * WHY NOT JUST A USERNAME AND PASSWORD IN THE CLIENT. A TURN relay carries the
 * media of a call, so a credential for one is a licence to spend bandwidth for
 * as long as somebody keeps using it. Shipping a fixed password to every
 * browser — which is what `NEXT_PUBLIC_TURN_CREDENTIAL` did until 2026-08-20 —
 * publishes that licence to anyone who opens devtools, and it can only be taken
 * back by changing it for everybody at once. That is the same shape as the
 * service-role key that had to be rotated on 2026-08-19.
 *
 * COTURN'S `use-auth-secret` MODE is what makes the alternative cheap. The
 * relay is given one shared secret and nothing else — no user list, no database,
 * no connection to Supabase. A credential is:
 *
 *     username   = "<expiry-unix-seconds>:<account-id>"
 *     credential = base64(HMAC-SHA1(shared-secret, username))
 *
 * coturn re-derives the password from the username it is handed and refuses
 * anything whose expiry has passed. So the server can mint a credential that
 * stops working on its own, and the relay never has to be told about it.
 *
 * The account id is in there because it costs nothing and makes abuse
 * attributable: a relay log names which account allocated the session.
 *
 * THIS MODULE IS PURE ON PURPOSE. It reads no environment and holds no state,
 * so the route can be thin and the credential format can be tested by
 * recomputing it — which is exactly what coturn will do. `scripts/e2e-smoke.mjs`
 * §15 does that recomputation rather than trusting the value.
 */

/** Free, run by Google, and used by nearly everything. Handles no media. */
export const STUN_ONLY = [{ urls: 'stun:stun.l.google.com:19302' }];

/**
 * Eight hours. Long enough that one fetch covers a sitting, short enough that a
 * credential which leaks is not a permanent relay. coturn checks the expiry
 * when the allocation is made, so a call already under way is not cut off when
 * its credential lapses mid-conversation.
 */
export const TURN_TTL_SECONDS = 8 * 60 * 60;

/**
 * Split `TURN_URLS` into the list an RTCIceServer takes.
 *
 * Anything that is not a relay URL is dropped rather than passed through: a
 * stray `https://` in this variable produces an RTCConfiguration the browser
 * rejects wholesale, which takes STUN down with it and breaks every call
 * instead of only the relayed ones.
 */
export function parseTurnUrls(raw) {
  return String(raw || '')
    .split(',')
    .map((u) => u.trim())
    .filter((u) => u.startsWith('turn:') || u.startsWith('turns:'));
}

/**
 * One credential pair, valid until `expiry`.
 *
 * `now` is injectable so the expiry can be asserted on rather than raced.
 */
export function mintTurnCredential({ secret, accountId, ttlSeconds = TURN_TTL_SECONDS, now = Date.now() }) {
  const expiry = Math.floor(now / 1000) + ttlSeconds;
  const username = `${expiry}:${accountId}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential, expiry };
}

/**
 * The whole answer the browser needs, relay or no relay.
 *
 * STUN IS ALWAYS INCLUDED, and a missing relay is not an error. Without a relay
 * calls still connect for the majority who can reach each other directly; they
 * fail only for the minority behind a symmetric NAT or a strict firewall. That
 * is a worse app, not a broken one — and returning an error here would turn a
 * missing relay into no calls at all for anybody. See FOLLOWUPS §1.
 */
export function buildIceServers({ urls, secret, accountId, ttlSeconds = TURN_TTL_SECONDS, now = Date.now() }) {
  const relayUrls = parseTurnUrls(urls);
  if (!relayUrls.length || !secret) {
    return { iceServers: STUN_ONLY, ttl: null, relay: false };
  }

  const { username, credential, expiry } = mintTurnCredential({ secret, accountId, ttlSeconds, now });
  return {
    iceServers: [...STUN_ONLY, { urls: relayUrls, username, credential }],
    // Seconds, not a timestamp: the browser caches against its OWN clock, and a
    // device whose clock is wrong would otherwise refresh constantly or never.
    ttl: ttlSeconds,
    relay: true,
    expiry,
  };
}
