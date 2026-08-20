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
 * Cloudflare's TURN service, which mints its own credentials.
 *
 * A DIFFERENT SCHEME, THE SAME SHAPE. There is no shared secret and no HMAC to
 * compute: their API returns a ready-made `iceServers` array, which is exactly
 * what this route already hands the browser. That is why adding this path
 * touched no client code at all.
 *
 * WORTH IT FOR PORT 443 ALONE. Their relay terminates TURN over TLS on 443, and
 * a firewall strict enough to need a relay is usually strict enough to block
 * 3478 and 5349 too. Self-hosting that means a certificate and its renewal.
 *
 * FAILS TO STUN, NEVER THROWS UPWARDS — see buildIceServers(). The timeout is
 * short because this sits in the path of starting a call: the browser caches
 * for the credential's whole lifetime, so this is normally once per session,
 * but the first call should not wait on a hung request.
 */
async function fetchCloudflareIceServers({ keyId, apiToken, ttlSeconds }) {
  const res = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: ttlSeconds }),
      signal: AbortSignal.timeout(5000),
    }
  );

  if (!res.ok) throw new Error(`cloudflare turn: HTTP ${res.status}`);

  const body = await res.json();
  const servers = Array.isArray(body?.iceServers) ? body.iceServers : [];
  // An empty array would be published to the browser as "no relay" with
  // `relay: true` attached, which is the one outcome worse than no relay: the
  // UI would stop explaining why a call could not connect.
  if (!servers.length) throw new Error('cloudflare turn: no iceServers in response');
  return servers;
}

/**
 * The whole answer the browser needs, relay or no relay.
 *
 * THREE OUTCOMES, CHOSEN BY WHAT IS CONFIGURED. Cloudflare wins when its two
 * variables are set, because it is the one that needs no server; coturn's
 * shared secret is the self-hosted path; neither means STUN alone.
 *
 * STUN IS ALWAYS INCLUDED, and a missing relay is NOT an error. Without a relay
 * calls still connect for the majority who can reach each other directly; they
 * fail only for the minority behind a symmetric NAT or a strict firewall. That
 * is a worse app, not a broken one — and returning an error here would turn a
 * missing relay into no calls at all for anybody. The same reasoning covers a
 * relay provider being down: degrade to what still works. See FOLLOWUPS §1.
 */
export async function buildIceServers({
  urls,
  secret,
  cloudflareKeyId,
  cloudflareApiToken,
  accountId,
  ttlSeconds = TURN_TTL_SECONDS,
  now = Date.now(),
}) {
  const stunOnly = { iceServers: STUN_ONLY, ttl: null, relay: false, provider: 'none' };

  if (cloudflareKeyId && cloudflareApiToken) {
    try {
      const servers = await fetchCloudflareIceServers({
        keyId: cloudflareKeyId,
        apiToken: cloudflareApiToken,
        ttlSeconds,
      });
      // Ours is prepended rather than trusting theirs to be there. The promise
      // this function makes is that STUN is always offered, and that should not
      // depend on another service's response shape not changing.
      return {
        iceServers: [...STUN_ONLY, ...servers],
        ttl: ttlSeconds,
        relay: true,
        provider: 'cloudflare',
      };
    } catch (e) {
      console.error('[calls] cloudflare TURN unavailable, falling back to STUN:', e.message);
      return stunOnly;
    }
  }

  const relayUrls = parseTurnUrls(urls);
  if (!relayUrls.length || !secret) return stunOnly;

  const { username, credential, expiry } = mintTurnCredential({ secret, accountId, ttlSeconds, now });
  return {
    iceServers: [...STUN_ONLY, { urls: relayUrls, username, credential }],
    // Seconds, not a timestamp: the browser caches against its OWN clock, and a
    // device whose clock is wrong would otherwise refresh constantly or never.
    ttl: ttlSeconds,
    relay: true,
    provider: 'coturn',
    expiry,
  };
}
