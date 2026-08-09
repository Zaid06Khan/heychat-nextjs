# Follow-ups

Things this codebase knows are wrong or unfinished. Each one is a project in its
own right.

**Status as of 2026-08-08.** Numbering is kept stable because commit messages
reference these by number — closed items stay in place rather than being deleted
and renumbered.

---

## Closed since the original port

- **#2 Earnings could be minted by the user** — closed by `0005_earnings.sql`.
  The amount is now the database's decision. *Partly* closed: see below, the
  activity still isn't verified and the economics are undecided.
- **#4 Attachments were publicly readable by URL** — closed by
  `0006_private_media.sql` and `/api/media/sign`.
- **#9 `ReportDialog` wiped the block list** — fixed. It read the list from a
  session object that never contained it.
- **#9 No rate limiting on the auth routes** — added, with a caveat below.
- **The UI** — rebuilt on a real design system ("Bodega"), and fonts now load
  at all, which they never had.

---

## 1. Video calls do not connect — HIGH

**Unchanged. It has never worked.**

`CallOverlay.jsx` calls `getUserMedia()` and renders *your own camera*. There is
no `RTCPeerConnection`, no signalling, no STUN/TURN. Two people "on a call" each
see themselves. The `calls` table records that a call happened and nothing else.

**What changed:** the entry point is gone. The button was removed from the
`ChatView` header, and "Video Calls" was removed from the landing page, where it
was advertising a feature that does not exist. The `/call/:conversationId` route
still exists so the screen can be developed against, and is now behind
`AuthGuard` (it wasn't).

To make it real you need three pieces, not one:
- **Signalling** — exchange SDP offers/answers and ICE candidates. Supabase
  Realtime broadcast can carry this; the dependency is already there.
- **TURN** — roughly 15–20% of connections can't do peer-to-peer and must relay.
  Paid and bandwidth-metered; there is no free-tier answer.
- **Group calls** — mesh peer-to-peer collapses past ~4 participants. Groups
  need an SFU.

Realistically: use LiveKit or Daily rather than building this.

## 2. Earnings — the hole is closed, the economics are not

**The minting hole is fixed.** `0005_earnings.sql` revoked client `INSERT` on
`earnings` at both the grant and policy layer, moved reward amounts into
`earn_rewards` (RLS on, no policy for `authenticated`, so the browser cannot
read it), and made `credit_earning()` the only way in — it takes an activity
type and never an amount.

**Three things are still open.**

**Nothing proves the activity happened.** `credit_earning()` can be called in a
loop. The real fix is signed server-to-server callbacks from the ad network
(AdMob SSV, ironSource, AppLovin all support this) with signature verification
and a replay-proof nonce. That is an integration, not a migration.

**The numbers lose money on every ad, everywhere.** Rewarded video pays roughly
$10–30 per thousand completed views in the US, and often under $2 per thousand
in South and South-East Asia — so somewhere between about two cents and a
twentieth of a penny per view. The app pays out **$0.05 per ad** and **$1.00 per
game play**. Even in the best market that is a loss on every single impression;
in the worst it is a loss of roughly 50×. Sustainable apps keep 50–80%.

**The $10 withdrawal minimum cannot be reached by most users.** At a realistic
share, someone watching ten ads a day needs around seven months in the US and
over a century in South Asia. The UI also promises a 10% revenue share, and
**there is no payout mechanism implemented at all**. Options worth weighing:
a much lower cashout, paying in mobile top-up or gift cards rather than cash, or
dropping money entirely in favour of streaks and unlocks.

Paying users real money carries regulatory weight (KYC, tax reporting, local
money-transmission rules). Worth a real decision before building further.

**Fraud.** Accounts are free, instant and anonymous, and the app pays money.
That is exactly what bulk-account fraud looks for, and ad networks ban for it
rather than merely withholding payment. This collides with the no-signup privacy
pitch and needs an answer *before* applying to a network.

## 3. End-to-end encryption — product decision

**Unchanged.** The claim was removed from the UI because message bodies are
stored as plaintext in `messages.content` and the server can read every one.

If you want it for real:
- Use **libsignal** or **MLS**. Do not hand-roll a protocol.
- Keys are generated and stored **on the device**. The server only ever stores
  ciphertext and public prekey bundles.
- Accept the consequences, because they are not small:
  - **Server-side search becomes impossible.** So does server-side moderation,
    which interacts badly with the Report flow.
  - **Multi-device needs a real design** (per-device keys + sender keys).
  - **Losing your device means losing your history**, unless you build encrypted
    backups with a recovery key.
  - Disappearing messages must be enforced on-device.
  - Push notification previews can no longer be generated server-side.

This conflicts with #6 (device binding) and with the recovery-password design.
Decide the identity model first.

## 4. Attachments — CLOSED

`0006_private_media.sql` made the `media` bucket private and dropped the public
read policy without replacing it. There is deliberately **no** SELECT policy: an
"any signed-in user may read" rule would still let any account fetch any
conversation's attachments by key.

Reads go through `POST /api/media/sign`, which mints a one-hour signed URL. For
an attachment it reads the message through the *caller's own session*, so the
existing RLS on `messages` decides who is entitled — reusing a boundary that is
already tested rather than writing a second one that can drift. For avatars and
group covers it will only sign a key that is genuinely referenced as one, which
stops the endpoint becoming a universal key-signing oracle.

`media_url` now holds a storage key. Pre-0006 rows hold an absolute public URL;
`toStorageKey()` normalises both, and the e2e suite covers that path.

Remaining minor: signed URLs last an hour, so a tab left open for longer will
need a refresh to re-fetch. The client cache already refreshes five minutes
early; a tab open for days is the untested case.

## 5. Disappearing-message cleanup is client-side — OPEN

`cleanupExpiredMessages()` runs in the browser when someone opens the app. If
nobody opens the app, expired messages sit in the database.

The RLS policy permits it safely (any conversation member may delete an
*already-expired* message), so it isn't a hole — it's unreliable. Move it to
`pg_cron` running a `SECURITY DEFINER` sweep every few minutes, and drop the
client call.

Note this now also leaves **orphaned storage objects**: deleting a message row
does not delete its attachment. The sweep should clean both.

## 6. Device binding is a fingerprint, and fingerprints lie — OPEN

Accounts are bound to a browser fingerprint (user-agent, screen size, canvas
render, timezone). The check is server-side, so the browser cannot skip it — but
be honest about what it is:

- It is **client-supplied data**. Its only protection is that the stored value
  lives in `account_secrets`, which no client can read.
- It **breaks for innocent reasons**. A browser update changes the user-agent. A
  GPU driver update changes the canvas hash. An external monitor changes screen
  dimensions. Each one permanently locks the user out.
- With no email on file, the recovery password is the *only* way back in. A user
  who never set one and whose fingerprint drifts has lost the account forever.

Options: drop binding in favour of ordinary sessions with a device list the user
can review; or keep it but require a recovery password at signup (currently
optional) and allow re-binding after recovery.

## 7. Username changes would orphan the auth user — LATENT

Supabase Auth keys users by email, and HeyChat has no emails, so each account
gets a synthetic address derived from its username
(`<username>@accounts.heychat.invalid`, see `src/lib/auth/shared.js`).

There is no username-change feature today. If one is added, it must update the
GoTrue user's email in the same transaction, or login breaks — the login route
looks the user up by the *derived* address.

Cleaner fix: store a stable random local-part at signup
(`<uuid>@accounts.heychat.invalid`) so the auth identity never depends on the
username. Worth doing before the first username-change ticket, not after.

## 8. Retire the shim, one screen at a time — OPEN

`src/api/base44Client.js` → `src/lib/shim/entities.js` exists so ~30 components
didn't have to change in a single pass. It is scaffolding.

Costs while it stays:
- Everything is a client-side query. No server rendering, no request waterfall
  control — `ConversationList` fetches conversations, then loops fetching the
  last message of each one separately.
- `.subscribe()` opens one realtime channel per call site; `ConversationList`
  opens two and refetches everything on any change to any message anywhere.
- The Base44 filter dialect (`{ $lt: ... }`) is translated at runtime instead of
  being a typed query.

Migration order that keeps risk low: `Landing` → `Login`/`Register` → `Contacts`
→ `Settings`/`Profile` → `ConversationList`/`ChatView` last. Delete each entity
from `TABLES` once nothing imports it.

## 9. Smaller items

**Still open:**

- **`accounts` is readable by every signed-in user.** Required for contact
  search and group member lists, and it holds no credentials — but it exposes
  `country`, `bio`, `last_seen` and `blocked_account_ids` to anyone with an
  account. `online_status_visibility` is a client-side courtesy, not enforced.
  Enforcing it needs a filtered view or an RPC.
- **The rate limiter is per-process.** `src/lib/auth/rateLimit.js` keeps counters
  in one server's memory. On a single instance that is exact; across several,
  each allows its own quota. Swap the store for Redis or a Postgres table when
  that matters — `check()` is designed not to change shape.
- **Non-English translations have never been reviewed by native speakers.** Ten
  locales in `src/lib/i18n.js`. Strings added since (landing copy, Earn labels,
  error messages) are English-only and not in the i18n file at all.
- **PWA has no service worker.** `InstallPrompt.jsx` offers installation, but
  there is no offline capability and **no push notifications**. For a messaging
  app that is close to disqualifying: you find out about a message when you next
  happen to open the app. Arguably the single biggest reason someone would try
  HeyChat once and not return. Web push is patchy on iOS, which ties this to the
  native-vs-web decision.
- **No migration tracking.** Six SQL files, applied by hand, with no table
  recording what has run — and they are *not* idempotent, so re-running from
  `0001` fails on an existing database. Fix this before the list gets longer.
- **Dead code from Base44.** `src/components/AuthLayout.jsx`, `GoogleIcon.jsx`
  and `ProtectedRoute.jsx` have zero references.
- **`src/components/ui/image.jsx` phones home.** It carries Wix/Base44 CDN
  transform logic that no longer applies, and falls back to a hardcoded
  `static.wixstatic.com` image on error — so a broken image makes a request to a
  third party. Worth stripping for privacy reasons alone.
- **`/design-preview` is still in the tree.** A throwaway route comparing the
  three candidate visual directions. Delete it once it has served its purpose.
- **Contacts and Profile still use stock form controls.** The design system
  reached the branded surfaces; plain inputs, selects and tabs were not part of
  that pass.
- **Nothing has been checked at phone width.** The layout is mobile-first and the
  nav fix was verified by inspecting the DOM, not by looking at it.
- **Two credentials need rotating.** The Supabase `service_role` key and the
  database password have both been pasted into chat transcripts. The key
  bypasses all RLS.

**Historical, for context:**

- `src/pages/ResetPassword.jsx` was deleted — it called
  `base44.auth.resetPassword` with an emailed reset token, which never applied
  to an app without email addresses.
- `src/components/ui/calendar.jsx` and `chart.jsx` were deleted — unreferenced
  shadcn boilerplate whose dependencies (`react-day-picker@8`, `recharts@2`)
  don't support React 19.
- Request duplication: a browser pass measured 10 Supabase requests to render
  `/home` with one conversation, brought to 7 by memoizing `getCurrentAccount()`.
  The rest is React StrictMode double-invoking effects in dev, plus
  `ConversationList`'s two realtime subscriptions and its N+1 "last message per
  conversation" loop. Fixing properly means moving these reads into TanStack
  Query (already a dependency) — part of retiring the shim (#8). Note media now
  adds one signing request per distinct attachment, cached per key.
