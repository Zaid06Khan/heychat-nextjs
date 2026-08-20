# The TURN relay

**Status: not deployed.** The app works without one and says so honestly when a
call fails. This is the runbook for standing one up, and the numbers you need to
decide whether to.

Everything on the app side is already built: `GET /api/calls/ice` mints
short-lived credentials, `src/lib/calls/ice.js` fetches and caches them, and
`CallBar` explains a failed call when no relay is configured. **Set two
environment variables and it starts being used.** Nothing else changes.

## Two ways to do it, and which was chosen

**Cloudflare Realtime TURN is the chosen path** (2026-08-20). Self-hosted coturn
still works and is documented below, but it is the fallback, not the default.

|  | Cloudflare | Self-hosted coturn |
|---|---|---|
| Cost at ~60 GB/month | **Free** — 1,000 GB/month included, then $0.05/GB | Free on Oracle Always Free, or ~$5-6/month VPS |
| Server to run | None | One, with patching and monitoring |
| TLS certificate | Theirs | Yours, plus renewal |
| TURN over 443 | Yes | Only if you configure and certify it |
| Attribution | Opaque username, not per-account | Account id is inside the username |
| Who sees the media | Cloudflare relays it, encrypted | You relay it, encrypted |

**Why not Oracle Cloud Always Free**, which genuinely would have worked — 10 TB
of monthly egress against a ~60 GB need, and coturn is bandwidth-bound rather
than CPU-bound, so their 1 GB micro instance is ample. The catch is that Oracle
reclaims idle Always Free compute when, over any 7-day window, CPU 95th
percentile is under 20% **and** network is under 20%. A relay at this scale is
idle almost all the time and uses about 0.5% of that network allowance, so it
fits the reclamation profile almost exactly. A relay that disappears is worse
than no relay, because it fails the calls that were working.

**In both cases the media is encrypted end-to-end.** WebRTC mandates DTLS-SRTP
and the keys are negotiated between the two browsers, so a relay forwards
packets it cannot read. What Cloudflare would see is metadata: which addresses
relay to which, and how much.

---

## Cloudflare: the whole setup

1. In the Cloudflare dashboard, **Realtime → TURN**, create a TURN key. You get
   a **key ID** and an **API token**.
2. Set both, server-side only:

```bash
CLOUDFLARE_TURN_KEY_ID=<the key id>
CLOUDFLARE_TURN_API_TOKEN=<the token>
```

That is the entire deployment. There is no server, no certificate and no
firewall rule.

`buildIceServers()` calls
`POST https://rtc.live.cloudflare.com/v1/turn/keys/<id>/credentials/generate-ice-servers`
with `{"ttl": 28800}` and passes the returned `iceServers` array through, with
our STUN entry prepended. Their response already contains the full URL set
including `turns:turn.cloudflare.com:443?transport=tcp`, which is the transport
that matters most — a firewall strict enough to need a relay usually blocks 3478
and 5349 as well.

**If their API is unreachable the app serves STUN alone** rather than failing.
The request has a 5-second timeout because it sits in the path of starting a
call; the browser caches for the credential's lifetime, so it is normally once
per session.

**What is lost versus coturn:** their username is opaque, so a relay session
cannot be traced back to an account the way the self-hosted scheme allows. There
is a revoke endpoint (`/credentials/<username>/revoke`) if that is ever needed,
but nothing here calls it.

---

## Checking it works, either way

**1. Does the app think a relay is configured?** Signed in, in the browser
console:

```js
await fetch('/api/calls/ice').then((r) => r.json())
```

`relay: true` with `provider: "cloudflare"` (or `"coturn"`) and an `iceServers`
entry carrying a `turn:`/`turns:` URL means it is wired up. `provider: "none"`
means either nothing is configured **or** the provider was unreachable and it
degraded — check the server log for `cloudflare TURN unavailable`, which is the
line that separates those two.

`scripts/e2e-smoke.mjs` §15 asserts the same thing on every run, and branches on
`provider` so it stays meaningful under either backend.

**2. Does a real call actually use it?** Harder, and worth doing once. Put one
side on mobile data with wifi off, call, and check `chrome://webrtc-internals`
on the other side for a selected candidate pair whose remote candidate type is
`relay`. A relay that is configured but never selected is the normal case — most
calls do not need it.

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
duration.** That is the entire cost story, and it is why the number to compare
between providers is bandwidth rather than CPU or hours.

| | Bandwidth through the relay |
|---|---|
| Audio call | ~50 kbps each way → **~45 MB/hour** per call |
| Video call (360p) | ~500 kbps each way → **~450 MB/hour** per call |
| Video call (720p) | ~1.5 Mbps each way → **~1.35 GB/hour** per call |

Only the 15-20% that cannot connect directly ever touch it. So for a hundred
people making one 10-minute video call a day, expect on the order of 15-20 calls
relayed, ~75 MB each, so **1-2 GB a day**.

That is roughly **60 GB a month**, which is the number every option below should
be measured against:

- **Cloudflare** includes 1,000 GB/month, so this is about 6% of the free
  allowance. Past it, $0.05/GB — traffic would have to grow more than sixteenfold
  before the bill reached a dollar.
- **Oracle Cloud Always Free** allows 10 TB/month of egress, roughly 170× the
  need. Free forever, with the idle-reclamation caveat above.
- **A small VPS** at Hetzner, DigitalOcean or Vultr is ~$5-6/month with a few TB
  of transfer — bandwidth is what to compare, not CPU, which coturn barely uses.

The other managed providers — Twilio's Network Traversal Service, Metered,
Xirsys — bill around $0.40-0.50/GB with no meaningful free tier, so they are
roughly ten times Cloudflare's rate at this volume.

---

## Self-hosted coturn, if you want it instead

Everything below this line is the fallback path. None of it is needed if you
are using Cloudflare.

### What the server needs

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

### Configuration

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

### Checking coturn actually works

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

### What is NOT verified by any of the above

That the relay carries media **under load**, and that the port range is wide
enough for the number of concurrent calls you actually get. 40 ports is roughly
40 simultaneous relayed sessions. Widen `min-port`/`max-port` and the firewall
rule together, or calls start failing to allocate once you are busy.

---

## Known gaps

- **The credential is fetched when the first call starts**, which adds one
  same-origin round trip to call setup — and again on the answering side. On the
  Cloudflare path that round trip contains a second one, to their API, capped at
  five seconds. It is cached for the credential's whole lifetime afterwards, so
  it is once per session in practice. Warming it when a conversation opens would
  remove even that; it has not been done because it has not been measured to
  matter, and it would spend a credential per conversation opened rather than
  per call placed.
- **`hasTurn()` is false until the first fetch**, so the "some networks need a
  relay" explanation in `CallBar` is only accurate once a call has been
  attempted. That is the right direction to be wrong in — it offers the
  explanation only when it knows there is genuinely no relay.
- **A relay that is configured but unreachable reads as "not configured"** in
  that message. The distinction has not been worth the extra state.
- **No per-account bandwidth limit.** coturn can cap it (`user-quota`,
  `total-quota`) but the app does not set one, and a credential is good for
  eight hours once minted. Worth revisiting if this is ever public.
- **On Cloudflare there is no per-account attribution.** Their username is
  opaque, so a relay session cannot be traced back to an account the way the
  coturn scheme allows — the account id is not in it. If that is ever needed,
  log the returned username against `accountId` when it is minted; nothing does
  today.
- **Nothing revokes a Cloudflare credential.** They expose
  `/credentials/<username>/revoke`, and the obvious use is a suspended account,
  but suspension does not call it — the credential simply expires on its own.
- **Neither path is verified against a live relay.** §15 checks the format and
  the shape; that coturn accepts an HMAC credential, or that Cloudflare's relay
  carries media, needs a real relay and real calls.
