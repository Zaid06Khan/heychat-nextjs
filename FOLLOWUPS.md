# Follow-ups

Things this migration pass deliberately left alone. Each one is a project in its
own right; none of them are blocked by the port.

The scope of the pass was: schema + RLS, real server-side auth, a compatibility
shim so the existing screens still work, and removing the false encryption claim.

---

## 1. Video calls do not connect  — HIGH

**Status: unchanged from the Base44 build. It never worked.**

`CallOverlay.jsx` calls `getUserMedia()` and renders *your own camera*. There is
no `RTCPeerConnection`, no signalling, no STUN/TURN. Two people "on a call" each
see themselves. The `calls` table records that a call happened and nothing else.

To make it real you need three pieces, not one:
- **Signalling** — exchange SDP offers/answers and ICE candidates. Supabase
  Realtime broadcast can carry this; you already have the dependency.
- **TURN** — roughly 15–20% of connections can't do peer-to-peer and must relay.
  This is a paid, bandwidth-metered service; there is no free-tier answer.
- **Group calls** — mesh peer-to-peer collapses past ~4 participants. Groups need
  an SFU.

Realistically: use LiveKit or Daily rather than building this. A managed SFU
removes all three problems for a per-minute fee. Building it yourself is
months, and TURN costs money either way.

Until then, consider hiding the call button — shipping a button that appears to
work but can't is worse than not having it.

## 2. Earnings can be minted by the user  — HIGH if this ever handles real money

The `Earn` screen sets the reward amount **in client code**
(`startActivity('game_play', 10, 1.00)`), then inserts a row.

`0002_rls.sql` tightened this so a user can only insert earnings for *themselves*
and can only read *their own* balance — under Base44 those were open. But the
amount is still whatever the browser sends. Anyone can open devtools and credit
themselves any balance.

The fix is structural, not a policy tweak:
- Revoke client INSERT on `earnings` entirely.
- Credit only from a server route that receives a **server-to-server callback**
  from the ad network (AdMob SSV, ironSource, AppLovin all support this), with
  signature verification and a replay-proof nonce.
- Keep reward amounts in a server-side config table, never in the bundle.

Separately, the economics need a look before any of this matters: $1.00 per
10-second game play and $0.05 per 15-second ad are far above what ad networks
actually pay out per impression. The current "How earnings work" copy also
promises a 10% revenue share and a $10 withdrawal minimum, and there is no payout
mechanism implemented at all. Paying users money has regulatory weight (KYC,
tax reporting, local money-transmission rules) — worth a real decision before
building further.

## 3. End-to-end encryption  — product decision

The claim has been removed from the UI (see `git log` for this pass), because
message bodies are stored as plaintext in `messages.content` and the server can
read every one of them.

If you want it for real:
- Use **libsignal** or **MLS**. Do not hand-roll a protocol.
- Keys are generated and stored **on the device**. The server only ever stores
  ciphertext and public prekey bundles.
- Accept the consequences up front, because they are not small:
  - **Server-side search becomes impossible.** So does server-side moderation,
    which interacts badly with the existing Report flow.
  - **Multi-device needs a real design** (per-device keys + sender keys).
  - **Losing your device means losing your history**, unless you build encrypted
    backups with a recovery key.
  - Disappearing messages must be enforced on-device; the server can't inspect
    what it can't read.
  - Push notification previews can no longer be generated server-side.

This conflicts with item 6 (device binding) and with the current recovery-password
design. Decide the identity model first, then implement.

## 4. Attachments are publicly readable by URL

`0003_storage.sql` creates the `media` bucket as **public**, matching Base44's
`UploadFile` behaviour: uploads return a plain URL that gets persisted into
`messages.media_url`.

Uploads are restricted — signed-in users only, into their own `<user-id>/` folder,
25 MB cap. But anyone holding or guessing a URL can fetch the object without
being in the conversation. URLs contain a UUID so they aren't enumerable, but
"unguessable URL" is not access control.

Fixing it means signed URLs, which expire — so `media_url` has to stop being a
stored absolute URL and become a storage key resolved at render time. That is a
schema + component change, which is why it isn't in this pass.

## 5. Disappearing-message cleanup is client-side

`cleanupExpiredMessages()` runs in the browser when someone opens the app. If
nobody opens the app, expired messages sit in the database.

The RLS policy permits it safely (any conversation member may delete an
*already-expired* message), so it isn't a hole — it's just unreliable. Move it to
`pg_cron` running a `SECURITY DEFINER` sweep every few minutes, and drop the
client call.

## 6. Device binding is a fingerprint, and fingerprints lie

Accounts are bound to a browser fingerprint (user-agent, screen size, canvas
render, timezone). This moved server-side in this pass — the browser can no
longer skip the check by editing JavaScript — but be honest about what it is:

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

## 7. Username changes would orphan the auth user

Supabase Auth keys users by email, and HeyChat has no emails, so each account
gets a synthetic address derived from its username
(`<username>@accounts.heychat.invalid`, see `src/lib/auth/shared.js`).

There is no username-change feature today. If one is added, it must update the
GoTrue user's email in the same transaction, or login will break — the login
route looks the user up by the *derived* address.

Cleaner long-term fix: store a stable random local-part at signup
(`<uuid>@accounts.heychat.invalid`) so the auth identity never depends on the
username. Worth doing before the first username-change ticket, not after.

## 8. Retire the shim, one screen at a time

`src/api/base44Client.js` → `src/lib/shim/entities.js` exists so ~30 components
didn't have to change in a single pass. It is scaffolding.

It has real costs while it stays:
- Everything is a client-side query. No server rendering, no request waterfall
  control — `ConversationList` fetches conversations, then loops fetching the
  last message of each one separately.
- `.subscribe()` opens one realtime channel per call site; `ConversationList`
  opens two and refetches everything on any change to any message anywhere.
- The Base44 filter dialect (`{ $lt: ... }`) is translated at runtime instead of
  being a typed query.

Migration order that keeps risk low: `Landing` → `Login`/`Register` (real routes,
server actions) → `Contacts` → `Settings`/`Profile` → `ConversationList`/`ChatView`
last, since they're the most realtime-heavy. Delete each entity from `TABLES`
once nothing imports it.

## 9. Smaller items

- **`accounts` is readable by every signed-in user.** Required for contact search
  and group member lists, and it holds no credentials — but it does expose
  `country`, `bio`, `last_seen` and `blocked_account_ids` to anyone with an
  account. `online_status_visibility` is currently a client-side courtesy, not
  enforced. Enforcing it needs a filtered view or an RPC.
- **Pre-existing bug in `ReportDialog.jsx`** (carried over untouched, not caused
  by the migration): it reads `session.blocked_account_ids`, but the session
  object has only ever held `{ id, username, language }`. So the value is always
  `undefined`, and blocking someone **overwrites** the block list with just that
  one person instead of appending. It should read the account from the database.
- **Residual request duplication.** A browser pass measured 10 Supabase requests
  to render `/home` with one conversation. Memoizing `getCurrentAccount()` and
  dropping the `auth.getUser()` round-trip brought it to 7. The rest is React
  StrictMode double-invoking effects in dev, plus `ConversationList` holding two
  realtime subscriptions that both refetch everything on any change, and its N+1
  "last message per conversation" loop. Fixing properly means moving these reads
  into TanStack Query (already a dependency) — part of retiring the shim (§8).
- **No rate limiting** on `/api/auth/login`. Supabase Auth has some built in, but
  add your own on username enumeration and registration.
- **Non-English translations of "Encrypted in transit"** were written during this
  pass and have not been reviewed by native speakers. Ten locales in
  `src/lib/i18n.js`.
- **`src/pages/ResetPassword.jsx` was deleted** — it called `base44.auth.resetPassword`
  with an emailed reset token, which never applied to an app without email
  addresses, and App.jsx had no route pointing at it.
- **`src/components/ui/calendar.jsx` and `chart.jsx` were deleted** — unreferenced
  shadcn boilerplate whose dependencies (`react-day-picker@8`, `recharts@2`)
  don't support React 19.
- **PWA has no service worker.** `InstallPrompt.jsx` offers installation, but
  there's no offline capability or push support. Push notifications for a
  messaging app are close to table stakes.
