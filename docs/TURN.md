# The TURN relay

**Status: not deployed.** The app works without one and says so honestly when a
call fails. This is the runbook for standing one up, and the numbers you need to
decide whether to.

Everything on the app side is already built: `GET /api/calls/ice` mints
short-lived credentials, `src/lib/calls/ice.js` fetches and caches them, and
`CallBar` explains a failed call when no relay is configured. **Set two
environment variables and it starts being used.** Nothing else changes.

---

## Why this exists at all

When two people call each other, their browsers try to send audio and video
**directly** to one another. Most of the time that works: STUN — a free, tiny
service that only tells a browser what its own public address looks like from
outside — is enough for them to find each other.

It fails when one side is behind a network that rewrites addresses
unpredictably. **Symmetric NAT** is the usual culprit: many mobile carriers,
most corporate firewalls, some hotel and university networks. The two browsers
exchange addresses that are already stale by the time the other tries them, and
the call rings and then simply never connects.

A **TURN relay** is a server with a stable public address that both sides can
reach. When a direct route cannot be found, both browsers send their media to
the relay and it forwards each to the other.

**Roughly 15-20% of connections need one.** That number is the industry figure
and it is not evenly spread — it is much higher on mobile data, which is exactly
where this app is meant to be used.

**The relay cannot read anything it carries.** WebRTC mandates DTLS-SRTP, and
the keys are negotiated end-to-end between the two browsers. TURN forwards
packets it cannot decrypt. A relayed call is exactly as private as a direct one.

---

## What it costs

The relay carries **the whole call, in both directions, for its whole
duration.** That is the entire cost story and it is why this is self-hosted
rather than bought per-minute.

| | Bandwidth through the relay |
|---|---|
| Audio call | ~50 kbps each way → **~45 MB/hour** per call |
| Video call (360p) | ~500 kbps each way → **~450 MB/hour** per call |
| Video call (720p) | ~1.5 Mbps each way → **~1.35 GB/hour** per call |

Only the 15-20% that cannot connect directly ever touch it. So for a hundred
people making one 10-minute video call a day, expect on the order of 15-20 calls
relayed, ~75 MB each, so **1-2 GB a day**.

A small VPS with a few TB of monthly transfer covers that many times over.
**$5-6/month** at Hetzner, DigitalOcean or Vultr is the realistic figure, and
bandwidth is the thing to check when comparing them — not CPU, which coturn
barely uses.

**The managed alternatives**, if you would rather not run a box: Cloudflare
Calls, Twilio's Network Traversal Service, Metered, Xirsys. They bill per
gigabyte, typically around $0.40-0.50/GB, which at the volume above is a few
dollars a month — comparable, until it isn't. They would need a different
`/api/calls/ice` implementation, because each mints credentials through its own
API rather than by HMAC. That is a small change, maybe an hour, if you go that
way.

---

## What the server needs

- **A real public IPv4 address.** Not behind a NAT of its own if avoidable; see
  `external-ip` below if it is. This is the one hard requirement — a relay whose
  address is itself unpredictable solves nothing.
- **A hostname pointing at it**, e.g. `turn.yourdomain`, and a TLS certificate
  for that name. Let's Encrypt is fine.
- **Ports open**, and this is where most first attempts fail:

  | Port | Protocol | For |
  |---|---|---|
  | 3478 | UDP and TCP | STUN/TURN, unencrypted |
  | 5349 | TCP | TURN over TLS — the one that gets through strict firewalls |
  | 49160-49200 | UDP | the relay range itself |

  **The relay range is the part people forget.** coturn allocates a fresh port
  per session from that range; if the range is closed, credentials work, the
  allocation succeeds, and no media ever flows. The failure looks like a call
  that connects and is silent.

- Debian/Ubuntu: `apt install coturn`, then set `TURNSERVER_ENABLED=1` in
  `/etc/default/coturn` or the service will not start.

---

## Configuration

`/etc/turnserver.conf`:

```conf
listening-port=3478
tls-listening-port=5349

# The relay's own public address. If the box is behind a NAT (most clouds are
# not; some are), this MUST be the public one — coturn advertises whatever is
# here, and advertising a private address is the single most common reason a
# relay appears to work and never carries anything.
external-ip=YOUR.PUBLIC.IP

# Keep this narrow and open exactly this range on the firewall.
min-port=49160
max-port=49200

# The credential scheme the app uses. No user database, no accounts on the
# relay: the app signs a username with the shared secret and coturn re-derives
# the password itself. See src/lib/calls/turnCredentials.js.
use-auth-secret
static-auth-secret=THE_SAME_STRING_AS_TURN_STATIC_AUTH_SECRET

# Must match the hostname on the certificate, and the host in TURN_URLS.
realm=turn.yourdomain
cert=/etc/letsencrypt/live/turn.yourdomain/fullchain.pem
pkey=/etc/letsencrypt/live/turn.yourdomain/privkey.pem

# Refuse to relay to private ranges. Without these the relay will happily
# forward traffic INTO your own network on behalf of anyone holding a
# credential, which turns it into a way through your firewall.
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255

# Not a proxy, not a STUN-only server, no CLI listener.
no-cli
fingerprint
```

Generate the secret with something that is actually random:

```bash
openssl rand -hex 32
```

Then `systemctl enable --now coturn`.

---

## Wiring it to the app

Two variables, both server-side. **Neither is `NEXT_PUBLIC_`** — see below.

```bash
TURN_URLS=turn:turn.yourdomain:3478,turns:turn.yourdomain:5349
TURN_STATIC_AUTH_SECRET=<the same string as static-auth-secret>
```

Set them in `.env.local` for development and in Vercel for Production, Preview
and Development (`docs/DEPLOY.md` §2).

**Offer both transports.** `turn:` on 3478 over UDP is what you want — it is the
lowest latency. `turns:` on 5349 is TLS over TCP, and it is what gets through a
firewall that blocks everything else, which is precisely the network where a
relay was needed in the first place. Listing both lets the browser pick.

### Why there is no `NEXT_PUBLIC_TURN_CREDENTIAL`

There used to be. A fixed relay password in the browser bundle is a licence to
spend your bandwidth, published to anyone who opens devtools, and revocable only
by changing it for every user at once. It is the same shape as the service-role
key that had to be rotated on 2026-08-19.

The app mints a credential per request instead, valid for eight hours:

```
username   = "<expiry-unix-seconds>:<account-id>"
credential = base64(HMAC-SHA1(shared-secret, username))
```

coturn re-derives the password from the username it is given and refuses
anything past its expiry, so the credential stops working on its own and the
relay never needs to hear about a revocation. The account id costs nothing and
makes abuse attributable — the relay log names which account allocated a
session. `/api/calls/ice` requires a signed-in session, because an open endpoint
minting these is a free relay for whoever finds it.

---

## Checking it actually works

**1. Is coturn running and authenticating?**

```bash
turnutils_uclient -T -u $(date -d '+1 hour' +%s):test \
  -w $(echo -n "$(date -d '+1 hour' +%s):test" \
       | openssl dgst -sha1 -hmac "YOUR_SECRET" -binary | base64) \
  turn.yourdomain
```

**2. Does a browser get a relay candidate?** This is the test that matters, and
it is the one to trust.

Open <https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/>,
remove the default server, add yours with a username and credential generated
the same way, and gather. **You are looking for a candidate of type `relay`.**
`host` and `srflx` candidates prove nothing — you get those without a relay.

No `relay` line means one of, in order of likelihood: the relay port range is
closed on the firewall; `external-ip` is wrong; the secret does not match; the
credential has already expired.

**3. Does the app see it?** Signed in, in the browser console:

```js
await fetch('/api/calls/ice').then((r) => r.json())
```

`relay: true` and an `iceServers` entry with a `turn:` URL means the app is
configured. `scripts/e2e-smoke.mjs` §15 asserts the same thing, including
recomputing the HMAC the way coturn will.

**4. Does a real call use it?** Harder, and worth doing once. Put one side on
mobile data with wifi off, call, and check `chrome://webrtc-internals` on the
other side for a selected candidate pair whose remote candidate type is
`relay`.

### What is NOT verified by any of the above

That the relay carries media **under load**, and that the port range is wide
enough for the number of concurrent calls you actually get. 40 ports is roughly
40 simultaneous relayed sessions. Widen `min-port`/`max-port` and the firewall
rule together, or calls start failing to allocate once you are busy.

---

## Known gaps

- **The credential is fetched when the first call starts**, which adds one
  same-origin round trip to call setup — and again on the answering side. It is
  cached for the credential's whole lifetime afterwards, so it is once per
  session in practice. Warming it when a conversation opens would remove even
  that; it has not been done because it has not been measured to matter.
- **`hasTurn()` is false until the first fetch**, so the "some networks need a
  relay" explanation in `CallBar` is only accurate once a call has been
  attempted. That is the right direction to be wrong in — it offers the
  explanation only when it knows there is genuinely no relay.
- **A relay that is configured but unreachable reads as "not configured"** in
  that message. The distinction has not been worth the extra state.
- **No per-account bandwidth limit.** coturn can cap it (`user-quota`,
  `total-quota`) but the app does not set one, and a credential is good for
  eight hours once minted. Worth revisiting if this is ever public.
