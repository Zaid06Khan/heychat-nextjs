# Follow-ups

Things this codebase knows are wrong or unfinished. Each one is a project in its
own right.

**Status as of 2026-08-09.** Numbering is kept stable because commit messages
reference these by number — closed items stay in place rather than being deleted
and renumbered.

---

## Closed since the original port

- **#2 Earnings could be minted by the user** — closed twice. `0005_earnings.sql`
  made the amount the database's decision; `0007_drop_earnings.sql` then removed
  the feature outright, so the question no longer arises. See #2 below.
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

## 2. Earnings — DROPPED, 2026-08-09

**The watch-and-earn feature is gone.** Not disabled, not parked behind a flag —
removed, by `0007_drop_earnings.sql` and the commit that accompanies it. The
`/earn` screen and route, the nav entry, the i18n keys in all ten locales, the
`Earning` shim entity, and the `earnings` / `earn_rewards` tables, the
`credit_earning()` and `list_earn_rewards()` functions and both enums are all
deleted. The e2e suite now asserts the surface is *absent*, so a database that
never ran `0007` fails loudly instead of quietly keeping it reachable.

The decision was taken because none of the three open problems below had an
answer that survived contact with the numbers.

**The numbers lost money on every ad, everywhere.** Rewarded video pays roughly
$10–30 per thousand completed views in the US, and often under $2 per thousand
in South and South-East Asia — so between about two cents and a twentieth of a
penny per view. The app paid **$0.05 per ad** and **$1.00 per game play**. Even
in the best market that is a loss on every impression; in the worst, ~50×.

**Nothing proved the activity happened.** `credit_earning()` could be called in
a loop. The real fix is signed server-to-server callbacks from the ad network
(AdMob SSV, ironSource, AppLovin) with signature verification and a replay-proof
nonce — an integration, not a migration.

**Fraud, structurally.** Accounts are free, instant and anonymous, and the app
paid money. That is exactly the shape of bulk-account fraud, which ad networks
ban for rather than merely withhold payment on — and fixing it means identity
checks that contradict the no-signup privacy pitch the product is built on.

Also unresolved when it was cut: no payout mechanism was ever implemented, a $10
minimum most users could never reach, and the regulatory weight of paying
strangers real money (KYC, tax reporting, money-transmission rules).

**If money ever comes back, it should not come back as this.** Charging for
something (storage, larger groups) is a different problem with none of the fraud
surface. The dropped code is in git history — `git show 371652e:src/screens/Earn.jsx`
— if it is ever wanted back.

**One thing survives the removal, deliberately:** citrus (`--accent`) is still
in the palette. It was introduced for Earn but is now carrying the online dot,
the add-contact button and "username is available". See `src/index.css`.

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

## 5. Disappearing-message cleanup — CLOSED, 2026-08-09

`0010_expiry_sweep.sql`. `delete_expired_messages()` is a `SECURITY DEFINER`
sweep on a five-minute `pg_cron` schedule, and the client call is gone.

The orphaned-storage half needed a second mechanism. Postgres cannot delete a
storage object — that needs the Storage API, reachable from the database only
with pg_net and a service-role key stored in it, which is a worse thing to own
than the problem. So the sweep queues keys in `expired_media` and
`/api/cron/sweep-media` drains the queue with the service role. Point a
scheduler at it; without `CRON_SECRET` set it refuses every request.

Two things to know. A row can outlive its expiry by up to five minutes, so the
client still filters on render and the conversation-list RPC excludes expired
rows — otherwise a message that has visibly disappeared from a thread lingers as
the sidebar preview. And the migration degrades rather than fails where pg_cron
is unavailable: the function still exists, it just needs driving from outside.

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

**The worst of it is fixed** (2026-08-09), without retiring the shim itself.
`ConversationList` used to do 1 + 2N queries — the conversations, then the other
participant and the last message of each, one at a time — and open *two*
realtime channels that each refetched everything on any change anywhere. It now
does four queries regardless of conversation count, on one debounced channel.
The last-message part needed `0011_conversation_list.sql`: "newest row per
group" is `distinct on` in Postgres and PostgREST cannot express it.

That work also fixed a bug nobody had filed: the list was ordered by
`conversations.updated_date`, and **nothing bumps a conversation row when a
message arrives** — so a new message never moved its conversation to the top,
which is the one thing that list is for. It now sorts by last message.

Costs while the shim stays:
- Everything is a client-side query. No server rendering, no request waterfall
  control.
- `.subscribe()` still opens one realtime channel per call site everywhere else.
- The Base44 filter dialect (`{ $lt: ... }`) is translated at runtime instead of
  being a typed query.
- **Push delivery depends on it** — see #10. Because messages are written from
  the browser, the notification is a second request the sender's tab has to
  survive to make. Moving sending behind a route handler closes that, and is now
  the highest-value single step here.

New surfaces added since (mutes, reactions, typing, push) deliberately go
straight to Supabase rather than through `TABLES`, so the shim shrinks by not
growing.

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
- **PWA has no *offline* capability.** Push notifications are now done (see #10)
  and `public/sw.js` is a real service worker, but it deliberately does not
  cache anything: a bad cache strategy serves users a stale build for weeks, and
  offline was never the point. Adding one is a separate, reversible decision.
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

## 10. Push notifications — DONE, with three known edges

Added 2026-08-09: `0008_push_subscriptions.sql`, `public/sw.js`,
`src/lib/push/*`, `/api/push/{subscribe,unsubscribe,notify}`, and a toggle in
Settings. The README section "Notifications" describes the design. Optional at
runtime — with no VAPID keys set, the app behaves exactly as it did before.

What is deliberately still imperfect:

- **Delivery depends on the sender's tab surviving one more request.** The
  notification is requested by the sender's browser after the message lands,
  because messages are still written client-side through the shim. If that tab
  dies in between, the message is delivered silently. This disappears when
  sending moves behind a route handler — see #8, which this is now a reason to
  do sooner. A database trigger with `pg_net` is the other option.
- **The rate limiter is per-process** (see below), and it is what bounds
  `/api/push/notify`. On several instances the notify budget multiplies.
- ~~No per-conversation mute, and no "hide message preview".~~ **Both added**
  in `0009_notification_prefs.sql`, applied server-side in the notify route —
  a muted conversation is dropped before a push is sent, and hidden previews
  mean the message text never leaves the server.

Two smaller notes. The service worker suppresses a notification when a visible,
focused tab is already on that exact conversation; doing that too often costs an
origin its push budget in Chrome, so the condition is kept narrow. And
`pushsubscriptionchange` cannot re-subscribe by itself — the worker has no
access to the VAPID key — so it messages the page, and the app re-asserts its
subscription on every start rather than trusting one success.

## 11. Replies, reactions, edit, delete, typing — DONE, 2026-08-09

`0012_message_interactions.sql` and `0013_typing_channels.sql`. Before this the
`messages` table had carried the same five meaningful columns since the port and
none of what people expect a messenger to do beyond "send text" existed.

**Delete is a real delete.** `deleted_at` is not a visibility flag with the body
still underneath — the update nulls `content` and `media_url` too, and a trigger
puts the attachment on the same `expired_media` queue the expiry sweep uses.
The e2e suite asserts a deleted message keeps no readable body, because "hidden"
shipped as "deleted" is how people get hurt.

**Typing indicators store nothing.** Realtime broadcast on a private channel,
authorised by RLS on `realtime.messages` using the same `is_conversation_member()`
as everything else.

Known gaps, in rough order of how soon someone will notice:

- **Edit and delete have no time limit and no history.** Every other messenger
  caps editing at some window; here a two-year-old message can be silently
  rewritten and only an "edited" marker shows. There is no record of what it
  said before. For a chat used to agree things, that is a real gap.
- **Reactions are not in the realtime feed.** They arrive when the thread
  reloads for some other reason. Adding `message_reactions` to a subscription is
  small; it just wasn't part of this pass.
- **Deleting a message does not clear the notification** already on someone's
  lock screen. The service worker would need to close notifications by tag.
- **`quoteFor()` only resolves replies inside the loaded 200 messages.** Reply to
  something older and it renders "original message unavailable" — technically
  honest, practically wrong. Needs fetching the quoted rows by id.
- **The reply quote is not clickable.** It should scroll to the original.
- ~~Typing indicators are untested.~~ **Verified 2026-08-09** by
  `npm run test:browser`, which drives two browser contexts as two real users.
  The `realtime.messages` policies in `0013` work against the live project.
  Push *delivery* is still the one thing no suite reaches — headless Chromium
  reports `Notification.permission` as `denied`, so the app correctly declines
  to register the worker. Real Chrome plus `npm run push:test` is the only way.
- **Read receipts are still N updates per thread load** — one RPC call per
  unread message in `ChatView.loadMessages()`. Untouched by the #8 work, which
  only fixed the conversation list.
