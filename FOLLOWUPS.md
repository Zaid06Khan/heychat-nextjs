# Follow-ups

Things this codebase knows are wrong or unfinished. Each one is a project in its
own right.

**Status as of 2026-08-16.** Numbering is kept stable because commit messages
reference these by number — a closed section keeps its number even after its text
moves to `FOLLOWUPS-CLOSED.md`.

## Index

**Read one section, not the whole file.** DONE does not mean nothing is left —
the four DONE sections below each carry gaps that are still open.

| § | Status | What it is | Still open? |
|---|---|---|---|
| 1 | **HIGH** | Video calls have never connected | Yes — needs signalling, TURN, an SFU. Use LiveKit or Daily. |
| 2 | DROPPED | Watch-and-earn | No → `FOLLOWUPS-CLOSED.md` |
| 3 | DECISION | No end-to-end encryption | Yes — multi-device is now real (§6), so a per-device key design is a prerequisite |
| 4 | CLOSED | Attachments were public by URL | No → `FOLLOWUPS-CLOSED.md` |
| 5 | CLOSED | Disappearing-message cleanup | No → `FOLLOWUPS-CLOSED.md` |
| 6 | CLOSED | Device binding gone; device list replaces it | 0018/0022 applied. Untested: revoking a *second* device |
| 7 | LATENT | Username changes would orphan the auth user | Yes — cheap now, expensive later |
| 8 | OPEN | Retire the shim, one screen at a time | Yes — `ChatView` reads still go through it |
| 9 | OPEN | Smaller items | Yes — 7 open, incl. two credentials to rotate |
| 10 | DONE | Push notifications | Gaps: per-process limiter; a narrow crash window |
| 11 | DONE | Replies, reactions, edit, delete, typing | 0016/0017/0020 applied. Gaps: notification not cleared on delete, read race, no optimistic send |
| 12 | DONE | Unread counts | Gap: mutes still count (the four-badge double-mount is fixed) |
| 13 | DONE | Group management | 0019 applied. Gaps: no audit trail, admin is a single point of failure |

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

Removed outright by `0007_drop_earnings.sql`. **Full write-up in
`FOLLOWUPS-CLOSED.md` §2** — the economics, the fraud surface, and why it should
not come back in this shape.

One live detail stays here: **citrus (`--accent`) survives in the palette,
deliberately.** It was introduced for Earn and now carries the online dot, the
add-contact button and "username is available". It is a fill, not a brand colour.
See `src/index.css`.

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

#6 used to make this moot — one account was one device, so there was nothing to
design. Binding is gone as of 2026-08-16, so multi-device is real and a per-device
key design is now a **prerequisite** rather than a complication. The
recovery-password question is still open and still interacts: a recovery flow that
restores access cannot restore keys it never had.

## 4. Attachments — CLOSED

The `media` bucket is private; reads go through `POST /api/media/sign`, which
signs against the caller's own session so `messages` RLS decides entitlement.
**Full write-up in `FOLLOWUPS-CLOSED.md` §4**, including why there is deliberately
no SELECT policy.

Remaining minor: signed URLs last an hour, so a tab open longer needs a refresh.
The client cache refreshes five minutes early; a tab open for days is untested.

## 5. Disappearing-message cleanup — CLOSED, 2026-08-09

`0010_expiry_sweep.sql`. A `SECURITY DEFINER` sweep on a five-minute `pg_cron`
schedule, plus `/api/cron/sweep-media` to drain the storage queue. **Full write-up
in `FOLLOWUPS-CLOSED.md` §5**, including why Postgres can't delete storage objects
itself.

Two things that still bite: a row can outlive its expiry by up to five minutes,
so the client filters on render and the conversation-list RPC excludes expired
rows. And where pg_cron is unavailable the function exists but needs driving from
outside.

## 6. Device binding — REMOVED, 2026-08-16

**Decided and done.** Accounts are no longer bound to a browser fingerprint.
`generateDeviceFingerprint()`, the check in `/api/auth/login`, the
`device_fingerprint_hash` column and the whole `/api/auth/device` route are
deleted; `0018_device_list.sql` drops the column and adds the replacement.

**What was wrong with it.** The fingerprint hashed user-agent, screen
dimensions, timezone, language, platform, a canvas render and
`hardwareConcurrency`. Between a laptop and a phone at least four of those
differ — not "might drift", differ, always. So one account was one device,
permanently, by construction, in a messenger, undocumented anywhere a user
would see it. It also locked people out for a browser update, a GPU driver
update or a new monitor, with the recovery password as the only way back and no
email to fall back on. What it bought in exchange was small: the value was
computed by the client and sent in the request, so it was a weak shared secret
whose only protection was that the stored copy sat in a table clients cannot
read.

**The proof it is gone is in the browser suite.** The phone-width pass used to
register its own account *because binding refused the desktop one* — that was
the sharpest evidence this entry ever had. It now signs in as the account
registered at 1280px and asserts it lands on `/home`.

**The replacement is a device list**, in Settings: real GoTrue sessions from
`auth.sessions`, read through `list_my_devices()` and ended through
`revoke_my_device()` — both `SECURITY DEFINER`, both filtered to `auth.uid()`,
because `auth.sessions` holds every user's sessions and must not become readable
by clients. Not a devices table of our own: that would describe sessions rather
than be them, and revoking a row in it would revoke nothing, since the browser
talks to PostgREST directly and a session is only dead when GoTrue says so.

**Revoking is honest about its limits.** Deleting the session kills its refresh
token, so that device cannot mint a new access token — but the access token
already in its hands stays valid until it expires, because a JWT is valid until
it expires and nothing can recall it. "Signed out within the hour" is the
promise, and the UI says so. Anything stronger needs a revocation check on every
request.

~~**Still open:** the two layers disagree about the recovery password.~~
**Closed 2026-08-16.** `/api/auth/register` now requires one, so the route is
authoritative and the form merely agrees with it. Absent and too-short get
different messages, because "must be at least 8 characters" reads as a
formatting complaint to someone who sent nothing.

Two things fell out of closing it. `Settings.jsx` was reading
`account.recovery_password_hash` — a column that lives on `account_secrets` and
has **never** existed on `accounts` — so it was always `undefined` and the screen
told everyone to set a recovery password, including people who had one.
`0022_recovery_password_status.sql` adds `have_recovery_password()`, one boolean
about the caller, leaving `account_secrets` as unreadable as it was. And an
account that genuinely has none now gets a warning saying so in as many words:
without one, a forgotten password means the account is gone.

Five accounts predate the requirement; all five are test accounts (`testbuddy`
and four stray `dbg*` leftovers from 2026-08-11). No real user was stranded.

**Applied 2026-08-16.** The defensive `to_jsonb(s) ->> '...'` reads turned out
to be unnecessary here — this project's `auth.sessions` has `user_agent`, `ip`
and `refreshed_at` — but they cost nothing and keep the migration installable
against an older GoTrue.

**Sessions record the real browser now**, which they did not at first. GoTrue
stamps the User-Agent and IP of whoever asks it to create a session, and on a
sign-in that is this server — so every session was labelled `node` with the
server's address, and every device in the list looked identical. That is most of
the feature. `getSupabaseRouteClient(request)` forwards the caller's headers on
the two routes that sign someone in. Proved by registering with a marker
user-agent and reading it back off `auth.sessions`.

**What has still NOT been exercised is a second real device.** Every check has
been one session listing itself, so `is_current` is confirmed and revoking
someone else's session is not. Sign in on a phone and revoke it from the laptop
before trusting that half.

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

**Sending has now left the shim** (2026-08-14) — the first write to do so, and
it went first because of what it was costing rather than to start at the top of
a list. `POST /api/messages` inserts the row and sends the notification in one
request; `src/lib/messages/send.js` is all the client keeps. See #10 for the bug
that closes, and the route's own comment for why the insert still goes through
the *caller's* session rather than the service role: `messages_insert_member`
was already the boundary and already tested, and a second membership check
written in JavaScript would only be a thing that could drift from it.

Three things stopped being the client's decision on the way through — `sender_id`,
`read_by` and `created_date` were already belt-and-braces, but **`expiry_at` was
a real hole**: the browser computed the disappearing-message expiry, so anything
posting to Supabase directly could send a permanent message into a disappearing
conversation. It is derived from `conversations.disappearing_timer` server-side
now, and the e2e suite sends a message that explicitly asks for no expiry and
asserts it gets one anyway.

One thing the move forced into the open: **a failed send used to vanish.**
`MessageInput` clears the composer the moment it hands the text over, and
`handleSend` had no `catch`, so anything that went wrong took the message with
it — no bubble, no error, nothing to retry. That was always true; adding a rate
limit made it likely enough to matter. There is now an inline error line above
the composer with a Retry that re-sends the same payload. It is the minimum:
there is no queue, so the text is held in one piece of component state and a
navigation away loses it.

`ChatView` still *reads* through the shim, and that is the larger half.

Costs while the shim stays:
- Everything else is a client-side query. No server rendering, no request
  waterfall control.
- `.subscribe()` still opens one realtime channel per call site everywhere else.
- The Base44 filter dialect (`{ $lt: ... }`) is translated at runtime instead of
  being a typed query.

New surfaces added since (mutes, reactions, typing, push, sending) deliberately
go straight to Supabase or to a route handler rather than through `TABLES`, so
the shim shrinks by not growing.

Migration order that keeps risk low: `Landing` → `Login`/`Register` → `Contacts`
→ `Settings`/`Profile` → `ConversationList`/`ChatView` last. Delete each entity
from `TABLES` once nothing imports it.

## 9. Smaller items

**Still open:**

- **`conversations.participant_ids` is an array with no foreign key**, so a
  conversation does not cascade when its members are deleted. Deleting an
  account leaves its conversations behind pointing at ids that no longer exist,
  and nothing ever collects them. Found 2026-08-10 with 18 orphaned rows in the
  project, all from test accounts; both test suites now delete conversations
  before users. A real fix is either a join table (`conversation_members`) with
  proper foreign keys, or a periodic sweep for rows whose participants have all
  gone. The join table would also make membership checks indexable instead of
  scanning an array.
- ~~`ConversationList` is mounted twice on `/home`.~~ **Fixed 2026-08-14.** It
  was in `AppLayout`'s sidebar (`hidden md:flex`) and again inside `Home`
  (`md:hidden`), with CSS picking — but React mounts what CSS hides, so both
  fetched and both opened a realtime channel, halving the work #8 did to get the
  list down to one channel and four queries. `BottomNav` was doubled the same
  way. `AppLayout` now renders one of each and only their *position* is
  responsive; `Home` is just the desktop placeholder. The browser suite counts
  DOM nodes (not `:visible`) at both widths, which is the assertion that was
  impossible to write before. One side effect worth having: off `/home` on a
  phone the list is hidden rather than unmounted, so switching tabs no longer
  tears down its channel and refetches on the way back.

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
- ~~No migration tracking.~~ **Added 2026-08-14**, once the list got longer
  (0016) exactly as this entry warned. `public.schema_migrations` records
  filename, checksum and date; each file runs in one transaction that also
  writes its ledger row, so there is no half-applied-but-recorded state. The
  hand-kept file list in `package.json` is gone too — the script reads the
  directory in filename order, which is what made adding 0016 a manual edit.
  `--plan` answers "what would run" with no database at all, `--status` shows
  applied vs pending, and an applied file that has since been edited is reported
  as drift rather than silently re-run.

  **The live project still needs adopting once** with `--baseline`, which
  records 0001–0015 as applied without executing them — they are not idempotent,
  so a first ordinary run would fail on `0001`. That is the one operation that
  can lie about reality, so it is explicit and prints every row it writes.
- ~~Dead code from Base44.~~ **Deleted 2026-08-16.** `AuthLayout.jsx`,
  `GoogleIcon.jsx` and `ProtectedRoute.jsx`, plus `src/hooks/use-size.jsx` which
  was orphaned by the image rewrite below.
- ~~`src/components/ui/image.jsx` phones home.~~ **Fixed 2026-08-16**, by
  deleting almost all of it. 244 lines of Wix Media Platform transform
  machinery — `/v1/fill/w_,h_,enc_webp/` URL building, a blurred 20px
  placeholder, a container-measuring hook, a DPR srcset — **none of which had
  run since 0006**. Media moved to a private Supabase bucket fetched by signed
  URL, so the Wix host check returned null for every image the app renders and
  both call sites had been falling through to a bare `<img>` for months.

  The one live part was the worst part: `onError` swapped in a hardcoded
  `static.wixstatic.com` image, so a broken attachment in a privacy-first
  messenger announced itself to a third-party CDN. It is a plain `<img>` now
  with an inert placeholder on failure, and the prop surface is unchanged so
  neither call site moved. Verified in a browser with a real uploaded
  attachment: it decodes, and **zero requests to wixstatic/base44**.
- ~~`/design-preview` is still in the tree.~~ **Deleted 2026-08-16.** The mocks
  are in git history, which is where `src/index.css` already points.
- **Contacts and Profile still use stock form controls.** The design system
  reached the branded surfaces; plain inputs, selects and tabs were not part of
  that pass.
- ~~Nothing has been checked at phone width.~~ **Checked 2026-08-10** and it
  passes. `npm run test:browser` now includes a 390×844 pass asserting no
  horizontal overflow on `/home`, `/chat`, `/settings` and `/contacts` —
  including with a 70-character unbroken word, the classic way a chat layout
  blows its width — that exactly one bottom nav is visible, and that the message
  action menu stays inside the viewport for both sent and received messages.
  Nothing needed fixing. The reason this sat open so long was tooling: the
  Chrome extension could not resize below desktop.
- **Two credentials need rotating.** The Supabase `service_role` key and the
  database password have both been pasted into chat transcripts. The key
  bypasses all RLS.

**Historical, for context:** deleted files and the request-duplication
measurements have moved to `FOLLOWUPS-CLOSED.md`.

## 10. Push notifications — DONE; the delivery gap closed 2026-08-14

Added 2026-08-09: `0008_push_subscriptions.sql`, `public/sw.js`,
`src/lib/push/*`, `/api/push/{subscribe,unsubscribe,notify}`, and a toggle in
Settings. The README section "Notifications" describes the design. Optional at
runtime — with no VAPID keys set, the app behaves exactly as it did before.

What is deliberately still imperfect:

- ~~Delivery depends on the sender's tab surviving one more request.~~
  **Closed 2026-08-14.** Sending goes through `POST /api/messages` (see #8),
  which inserts the message and then notifies from Next's `after()` — after the
  response is on the wire, still inside the same server invocation. So the
  composer never waits on a round trip to FCM, and the notification is no longer
  something the sender's tab has to stay alive to ask for. `/api/push/notify` is
  **deleted**, along with the machinery it needed to survive being callable with
  any message id at all: reading the row through the caller's session, checking
  they were its sender, and a one-minute window so a captured id could not be
  replayed. None of that was protecting anything real — it was protecting
  against the shape of the design, and the shape changed.

  What is left is the narrow, honest version of the same failure: if the server
  process dies between the insert and the `after()` callback, the message is
  delivered silently. That is one process, in one place, for a few hundred
  milliseconds, instead of every user's browser tab for the length of a request.
  A database trigger with `pg_net` is still the only thing that would close it
  completely, and still costs a service-role key stored in the database.
- **The rate limiter is per-process** (see below), and it now bounds
  `/api/messages` at 60 sends per account per minute — the first send limit this
  app has ever had; before this, message inserts went straight to Postgres with
  nothing counting them. On several instances the budget multiplies.
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

**Delete for me — added 2026-08-14, live 2026-08-16.** There was only ever
"delete for everyone", so the only way to get a message out of your own view was
to take it out of everyone's. `0016_message_hides.sql` adds a `message_hides`
table: your own row, ordinary RLS on `account_id = auth.uid()`, and the message
itself untouched. It is a table rather than a `hidden_by` array on `messages`
for the same reason `read_by` needed `mark_message_read()` — a recipient writing
to someone else's message row would mean widening `messages_update_sender`,
which is the shape of hole 0015 spent a migration closing on `conversations`.

Both list RPCs (`last_messages_for_conversations`, `unread_counts`) were
replaced to exclude hidden rows, or a message you had removed from your own view
would keep announcing itself from the sidebar preview and the unread badge.

**Be precise about what it is: a view preference, not a deletion.** The body
still exists and the server can still read it. "Delete for everyone" remains the
only one that destroys anything, which is why the two are named differently and
only the destructive one is drawn in the alert colour.

**The migration has not been applied** — this tree has no `DATABASE_URL`, so it
was applied on 2026-08-16 and verified against the live project.
`getHiddenMessageIds()` still degrades to "nothing hidden" rather than throwing,
which stays correct for any database carrying the code without the migration.

Known gaps, in rough order of how soon someone will notice:

- ~~Edit has no time limit and no history.~~ **Closed 2026-08-16** by
  `0020_edit_history.sql`. Fifteen minutes from *sending* — not from the last
  edit, or editing every fourteen minutes keeps the window open forever — and
  `message_edits` keeps each previous wording, readable by anyone who can read
  the message. The "edited" marker is a button that shows them.

  **The point of that migration is the GRANT, not the table.** A window enforced
  inside an RPC is worth nothing while the client can still
  `update messages set content = ...`, which `messages_update_sender` plus a
  blanket UPDATE grant allowed — the same shape of hole 0015 closed on
  `conversations`. `authenticated` now has no UPDATE on `messages` at all; the
  three legitimate writes each have a `SECURITY DEFINER` function
  (`mark_message_read` from 0002, `edit_message` and
  `delete_message_for_everyone` from 0020).

  **Applied 2026-08-16, and the fallbacks are deleted.** This was the first
  migration to MOVE a working feature rather than add one, so the client briefly
  shipped with `editMessage` and `deleteMessageForEveryone` falling back to
  their old direct writes when the function was missing. Both are gone now the
  functions exist. The e2e suite asserts the part that matters: a direct UPDATE
  by the author returns `permission denied for table messages`, and an hour-old
  message is refused with "messages can only be edited for 00:15:00 after
  sending".
- ~~Reactions are not in the realtime feed.~~ **Fixed 2026-08-16, and it needed
  a migration nobody expected.** The client half is a `message_reactions`
  subscription in `ChatView`. The reason it had never worked is that 0012
  created the table but never added it to the `supabase_realtime` publication —
  `0017_reactions_realtime.sql` does that. Worth remembering as a failure mode:
  subscribing to an *unpublished* table succeeds. The channel joins, no error is
  raised, and no event ever arrives, so the code reads as correct and does
  nothing. **Applied 2026-08-16**, and the browser suite now
  asserts a reaction reaching the other person with no reload.
- **Deleting a message does not clear the notification** already on someone's
  lock screen. The service worker would need to close notifications by tag.
- **The sender does not see their own message until realtime delivers it.**
  `ChatView` has no optimistic append: sending posts to `/api/messages`, and the
  bubble appears only when the subscription fires and triggers a reload. So the
  composer depends on a websocket for something that needs no server opinion at
  all — the row is already written and the response carries it.

  Seen rather than theorised: two browser-suite assertions failed on a run where
  every `POST /api/messages` returned 200, because the UI never rendered what
  the server had accepted. A clean run passed, so it is churn rather than a
  hard break — which is exactly what makes it worth writing down. Appending the
  returned message and letting the realtime reload reconcile would remove the
  dependency.
- ~~`quoteFor()` only resolves replies inside the loaded 200 messages.~~
  **Fixed 2026-08-16.** Quoted rows outside the batch are fetched by id
  (`getMessagesByIds`), so an old original shows its real preview instead of
  "original message unavailable" — which is now reserved for the case it was
  always right about, a deleted or expired original.
- ~~The reply quote is not clickable.~~ **Fixed 2026-08-16.** It scrolls to the
  original and flashes it — without the flash you arrive somewhere in the thread
  with no idea which message you were sent to. Only a quote whose original is
  actually rendered becomes a button; one resolved by id has nowhere to scroll
  to, and pretending otherwise would be a dead control.
- ~~**The thread loaded the OLDEST 200 messages, not the newest.**~~ **Found and
  fixed 2026-08-16**, while building a 220-message fixture to test the two
  entries above. `loadMessages()` sorted `created_date` ascending with
  `limit(200)`, which takes the first 200 rows — so any conversation past that
  length showed the first 200 messages ever sent, nothing since, and no new
  arrivals ever. It now takes the newest 200 and reverses them for display.

  This had been true since the port and nothing caught it, because no test
  conversation had ever exceeded 200 messages. `test:browser` now builds a
  205-message thread and asserts the newest is on screen and the oldest is not.
- ~~Typing indicators are untested.~~ **Verified 2026-08-09** by
  `npm run test:browser`, which drives two browser contexts as two real users.
  The `realtime.messages` policies in `0013` work against the live project.
- ~~Push delivery is untested.~~ **Verified 2026-08-09 on a real device.** A
  throwaway account sent a genuine message and asked `/api/push/notify` for the
  notification the way the app does — ownership and freshness checks included,
  no shortcut — and it arrived via FCM (`sent: 1`). No automated suite reaches
  this: headless Chromium reports `Notification.permission` as `denied`, so the
  app correctly declines to register a worker there. Re-testing means real
  Chrome, either `npm run push:test -- <username>` for the delivery plumbing
  alone, or a second account for the whole path.
- **Two notification behaviours have never met a real device**: `mute` and
  `hide_notification_preview`. Both are enforced server-side in the notify route
  and both are covered by the e2e suite at the database level, but nobody has
  confirmed that a muted conversation stays silent on an actual phone.
- ~~Read receipts are still N updates per thread load.~~ **They were worse than
  that: they had never worked at all.** Fixed 2026-08-11. `loadMessages()` wrote
  `read_by` with a direct table update, but `messages_update_sender` is
  `using (sender_id = auth.uid())` — so a *recipient* marking a message read
  matched zero rows, and PostgREST answers that with 200 and an empty array, not
  an error. The write silently hit nothing, every time, for everyone, since
  0001. `0002_rls.sql` says so in a comment directly above the policy
  ("Recipients marking a message read do NOT go through here — they call
  `mark_message_read()`"); the client simply didn't. It now calls the RPC, via
  `markRead()` in `src/lib/unread.js`.

  **Nothing caught this for months because nothing read `read_by` back.** The
  e2e suite passed throughout — it calls the RPC directly, so it was testing the
  database, not the client. Adding the unread badge is what made an invisible
  failure visible, which is the argument for building the feature that consumes
  a field before trusting the field.

  Still N calls per thread load, now fired in parallel rather than in sequence.
  One RPC taking an array would make it one round trip.

  **A narrow race survives:** `loadMessages()` renders the thread *before* it
  awaits the receipts, so opening a conversation and navigating away
  immediately can cancel them in flight and leave it unread. The browser suite
  waits on the `mark_message_read` response rather than on the message
  appearing, for exactly this reason. Real users linger and the next open
  catches it, so this is logged rather than fixed.

## 12. Unread counts — DONE, 2026-08-11

`0014_unread_counts.sql`. `messages.read_by` had been written on every message
since 0001 and never once read back: no badge, no bold, no count. You found out
a conversation had something new in it by opening it.

`unread_counts(conv_ids)` counts in Postgres — one round trip for the whole
list, because counting client-side means fetching every message of every
conversation, which is the N+1 that `0011` exists to have removed. It is
`security invoker` on purpose (same reasoning as 0011): as `definer` it would
report the traffic volume of any conversation whose id someone guessed.

Excluded from the count: your own messages, tombstones, and rows past their
expiry that the five-minute sweep has not collected yet — a badge pointing at
"This message was deleted" or at something already gone is worse than no badge.

Known and deliberate:

- **Muted conversations still count.** Muting silences the notification; it does
  not mark anything as read. Whether the badge should respect a mute is a
  product call nobody has made.
- **The badge is published through a module-level store** (`src/lib/unread.js`)
  rather than context. The reason was that `ConversationList` and `BottomNav`
  were each mounted twice on `/home` — a debug run counted **four** badges for
  one unread message — and **that is fixed** (see #9, 2026-08-14): there is one
  of each now. The store stays because it is still the right shape for a value
  one component computes and a sibling elsewhere in the tree displays, but it is
  no longer load-bearing against a duplicate, and context would work fine now.
- Read marking is what clears it, so it inherits the race noted in #11.

## 13. Group management — DONE, 2026-08-11

`0015_group_management.sql`, `src/lib/groups.js`, `GroupInfoDialog.jsx`. A group
used to be whatever `GroupCreateDialog` made it, permanently: no adding, no
removing, no rename, and **no way to leave**. Being added to a group was a trap.

**It also closed a hole that was already open**, which is why the migration does
more than add functions. `0002`'s `conversations_update_member` was row-level
with no column restriction, so any member could UPDATE any column of a group
they belonged to — add anyone, remove the admin, set `admin_id` to themselves,
rename it. Only the absence of UI stopped it. RLS cannot express "this column
but not that one", so the UPDATE grant is now narrowed to `disappearing_timer`
and everything else goes through `SECURITY DEFINER` functions where the rules
are written down. The e2e suite asserts all four refusals.

Two consequences are decided server-side because the client cannot be trusted
to: the longest-standing member inherits admin when the admin leaves, and the
last member out deletes the group rather than leaving an unreachable row.

Known gaps:

- **No record of who added or removed whom.** Members appear and vanish with no
  history, which for a group used to agree things is the same gap as #11's
  missing edit history.
- ~~No invite flow, and the block list is not consulted.~~ **Both closed
  2026-08-16** by `0019_group_invites.sql`. These read as two gaps and were
  really one: the admin added people directly, so there was no consent step —
  and since nothing checked `blocked_account_ids`, **someone you had blocked
  could still put you in a room with themselves**, which is most of what
  blocking is supposed to prevent.

  `group_add_member()` is dropped rather than aliased: a function named "add"
  that now only asks would be misread. `group_invite_member()` creates a pending
  invite after checking admin, capacity, the block list and the invitee's
  `group_add_permission`; `group_invite_respond()` is the only thing that
  changes `participant_ids`, and it re-checks capacity and membership at accept
  time because an invite can sit for days. Listing is an RPC rather than a
  select, because the invitee is by definition not a member yet and
  `conversations_select_member` will not show them the group's name — it returns
  the name and the inviter and nothing else about a conversation they have not
  joined.

  **Applied 2026-08-16.** The e2e suite now asserts the whole flow: a non-admin
  refused, a blocked admin refused, an invitation that does not by itself add
  anyone, someone else unable to answer it, the invitee seeing a group name she
  is not yet a member of, and acceptance putting her in.
- **Admin is a single point of failure.** One admin, no co-admins, and no way to
  transfer deliberately — succession only happens by leaving.
- The member list still reads `accounts` directly, so it inherits the exposure
  noted in #9.
