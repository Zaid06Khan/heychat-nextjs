# Follow-ups

Things this codebase knows are wrong or unfinished. Each one is a project in its
own right.

**Status as of 2026-08-18.** App renamed Calamuse -> **Calamus3** on 2026-08-18;
see CLAUDE.md for the three identifiers that keep the old spelling.
 Numbering is kept stable because commit messages
reference these by number — a closed section keeps its number even after its text
moves to `FOLLOWUPS-CLOSED.md`.

## Index

**Read one section, not the whole file.** DONE does not mean nothing is left —
the four DONE sections below each carry gaps that are still open.

| § | Status | What it is | Still open? |
|---|---|---|---|
| 1 | PARTIAL | 1:1 audio **and video** calls work; groups do not | Yes — **no TURN relay**, so ~15-20% of networks cannot connect |
| 2 | DROPPED | Watch-and-earn | No → `FOLLOWUPS-CLOSED.md` |
| 3 | DECISION | No end-to-end encryption | Yes — **plan written**, `docs/E2E-ENCRYPTION.md`. Needs three product answers before any code |
| 4 | CLOSED | Attachments were public by URL | No → `FOLLOWUPS-CLOSED.md` |
| 5 | CLOSED | Disappearing-message cleanup | No → `FOLLOWUPS-CLOSED.md` |
| 6 | CLOSED | Device binding gone; device list replaces it | 0018/0022 applied. Untested: revoking a *second* device |
| 7 | CLOSED | Username changes would orphan the auth user | No — 0026 applied 2026-08-19 |
| 8 | CLOSED | Base44 shim retired | No — deleted 2026-08-18. Gap: dead `CallOverlay` route |
| 9 | OPEN | Smaller items | Yes — 5 open. Contact search fixed 2026-08-19; **both credentials rotated 2026-08-19** |
| 10 | DONE | Push notifications | Gaps: per-process limiter; a narrow crash window |
| 11 | DONE | Replies, reactions, edit, delete, typing | 0016/0017/0020 applied. Gaps: notification not cleared on delete, read race, no optimistic send |
| 12 | DONE | Unread counts | Gap: mutes still count (the four-badge double-mount is fixed) |
| 14 | DONE | Moderation: queue, suspension, audit trail | Gaps: reported content untouched, no appeal path |
| 13 | DONE | Group management | 0019 applied. Gaps: no audit trail, admin is a single point of failure |

---

## 1. Calls — 1:1 audio and video work, 2026-08-18. Groups do not.

**1:1 audio calls connect for real.** `0025_call_channels.sql` authorises a
private `call:<conversation_id>` Realtime channel using the same
`is_conversation_member()` rule as everything else; `src/lib/calls/controller.js`
does the offer/answer/ICE and owns the peer connection; `CallBar.jsx` is mounted
in `AppLayout` so a call outlives the screen it started on.

**What the old code was.** `CallOverlay.jsx` called `getUserMedia()` and rendered
*your own camera*, muted. No `RTCPeerConnection`, no signalling, no relay — two
people "on a call" each watched themselves. None of it was reused.

**Calls are the most private thing in this app.** WebRTC mandates DTLS-SRTP, so
the audio is end-to-end encrypted between the two browsers while message bodies
sit in plaintext in Postgres (§3). That holds even on a relayed call: TURN
forwards packets it cannot read.

**Verified between two real browsers**: the button appears only in direct
conversations, the caller sees ringing, the other side is rung, the connection
reaches `connected` and counts a duration, remote audio is attached to a playing
element, and hanging up clears both sides with no page errors.

That last clause was earned. The first run connected *and* threw
`setRemoteDescription ... Called in wrong state: stable`, because
`watchForCalls` opened the signalling channel and `startCall` opened a second on
the same topic, overwriting the reference and leaking the first — so every
signal arrived twice. The call still worked, which is what would have let it
survive. `openChannel` is idempotent per topic now.

**The second call never arrived, 2026-08-18.** One call worked; hang up, call
again, and the other person's phone stayed quiet. `cleanup()` removed the
Realtime channel at the end of every call — including the channel `watchForCalls`
had opened to *listen* for calls, which the two shared. Nothing re-opened it,
because that effect only re-runs when the conversation changes, and it had not
changed. Both people sat in the chat believing the other was ignoring them.

The fix is a `watching` flag: while a screen is holding the channel open, ending
a call may not close it, and returning to idle keeps `meId` / `conversationId` /
`peerName` so the next incoming offer can still be answered. **A single-call test
cannot see this bug**, which is how it shipped — `7c. CALLING, TWICE` in
`scripts/browser-smoke.mjs` now places two calls in a row for exactly that reason.

**Nothing rang, 2026-08-18.** Calls were silent on both sides — the screen said
"Ringing…" while no sound was ever made, so an incoming call was invisible unless
you happened to be looking at the tab. `startRinging()` / `stopRinging()` in
`src/lib/sound.js` synthesise both parts: a rising two-note ringtone for the
person being called, a single long ringback tone for the person calling, each
repeating until the call is answered, declined, or cleaned up.

Two details worth keeping:

- **Ringing ignores the "Sound for new messages" setting.** `play()` takes a
  `force` flag for this. Muting message chimes is a different intention from
  wanting to miss calls.
- **Message and send sounds were far too quiet** — peak gain 0.09 and 0.05.
  They were audible in isolation and inaudible in a room, which is
  indistinguishable from broken. Now 0.28 and 0.16.

**Video calls work, 2026-08-18.** A second button in the chat header starts one.
`VideoStage.jsx` is the surface — their video full-bleed, yours picture-in-picture
and mirrored, with mute, camera and hang-up. It is mounted from `CallBar`, which
is in `AppLayout`, so the call still outlives the screen it started on.

Four decisions in there are load-bearing:

- **The kind of call is chosen before it starts, not during.** Turning a camera
  on mid-call means renegotiating the peer connection, which needs glare
  handling to be safe. Inside a video call the camera toggles by disabling the
  track, which needs no renegotiation at all. Escalating audio -> video is still
  open, below.
- **An audio call never asks for the camera.** Unchanged from the first pass and
  still the right call: a permission prompt for a device the app will not use is
  the one people refuse, and refusing is sticky.
- **A video call with no camera becomes an audio call**, rather than no call.
  `state.video` stays true if *they* called with video, so it stays asymmetric —
  one person visible is worth more than a call that refuses to connect.
- **Camera state is signalled, not inferred.** A disabled track keeps arriving,
  as black frames on a `live` track, so the receiver cannot tell "camera off"
  from a call that has broken. Both sides send `camera` on toggle and once on
  connect, and the stage shows their name rather than a black rectangle.

**And it exposed a bug that had nothing to do with video.** An offer sent in the
window between the other person opening the conversation and their Realtime
channel finishing its subscribe was **lost in silence** — Realtime does not
replay a broadcast to a subscriber who was not there yet. Their phone never
rang, yours rang out, nothing logged an error. It was invisible in the suite
because the suite's own waits happened to be slower than the race; it only
appeared when a tighter script drove the same flow. The callee now acknowledges
an offer with `ringing`, and an unacknowledged offer is sent once more after two
seconds. A repeat offer on a call already ringing re-acknowledges rather than
starting a second ringtone.

**Video "worked" and looked like an audio call, fixed 2026-08-18.** Reported
from a real device the same day it shipped. Three faults, each enough on its own:

- **`ontrack` published only for a NEW stream.** It fires once per track and
  both tracks arrive on the same stream object, so the video track's arrival
  published nothing — React never re-rendered and the stage kept the
  placeholder it drew when only audio existed. The video was arriving the whole
  time with nothing to paint it.
- **A camera that would not open collapsed the whole call to audio.**
  `startCall` set `video: gotVideo`, so a refused or busy camera dropped you
  back to the audio bar — and you could not see THEM either. Worse, with no
  local video track the offer carried no video m-line, and an answer cannot
  introduce one, so their camera became unusable too. A video call now stays a
  video call and adds a `recvonly` transceiver when this side has nothing to
  send. One broken webcam costs your own picture and nothing else.
- **The fallback was silent.** No message said the camera had not opened, so it
  read as the feature being broken. The stage says so now.

**The test that should have caught this asserted the wrong thing.** It queried
every `<video>` on the page and accepted any of them having frames — and the
LOCAL preview always does, because it is your own camera. It passed while the
remote video sat hidden behind the placeholder. It now checks
`video[data-remote-video]` specifically, and that it is actually visible: a
`display:none` video still decodes and still reports `videoWidth`, so the
visibility check is doing real work. §7e drives the no-camera path end to end.

### Still open

- **No TURN relay yet.** Roughly 15–20% of connections cannot go peer-to-peer —
  symmetric NAT, strict corporate firewalls, some mobile carriers — and need
  their audio relayed. Without one those calls fail rather than all calls
  failing, which is why this shipped before the relay existed. `ice.js` reads
  `NEXT_PUBLIC_TURN_URL` / `_USERNAME` / `_CREDENTIAL`, so turning it on is
  configuration rather than code. coturn on the existing DigitalOcean droplet is
  the plan. **This is the one thing between "works for most people" and "works".**
- ~~**Ringing only reaches you inside that conversation.**~~ **Fixed
  2026-08-18 with push.** `watchForCalls` is still scoped to the chat on screen
  — listening everywhere would mean one channel per conversation, permanently —
  but a call no longer depends on it. `POST /api/calls/ring` sends a Web Push
  the moment the offer goes out, so a call reaches a closed app.

  Tapping it opens the conversation, and **`ring-request` is what makes that
  worth anything**: Realtime never replays a broadcast to a subscriber who was
  not there, so the offer sent thirty seconds ago is gone. Opening a
  conversation now asks "is anyone ringing?", and a caller still waiting
  re-sends the offer. Unconditional, because the answer is free when nobody is.

  **It does NOT auto-answer.** A notification tap is consent to look at the
  call, not to open a microphone — and answering should stay a deliberate act.
  You get the ordinary incoming-call UI with Accept and Decline.

  Three things the ring deliberately does differently from a message push: a
  50-second TTL just past the ring timeout, so a phone that comes back online
  late does not offer a call that ended; `urgency: 'high'`, so the push service
  does not batch it; and its own notification tag with `requireInteraction`, so
  a message arriving mid-ring cannot replace the one notification that is only
  useful for the next forty seconds. Mutes and blocks still apply. Hiding
  message previews does not — that is about your words on a lock screen, not
  about whether you find out someone is calling.

  **A late joiner is also given the caller's ICE candidates.** Re-sending the
  offer alone is not enough: by the time somebody taps a notification the
  caller has finished gathering and `onicecandidate` will never fire again, so
  they would hold an SDP with no route back. On one machine ICE can still limp
  to a connection from the answerer's candidates alone — which is why this
  failed intermittently rather than always, and why it would fail far more
  often across real networks. Candidates are kept and replayed.

  **Still missing: there is no missed-call record.** The notification is the
  only trace, and once it is dismissed the call leaves nothing behind. That
  needs the `calls` table to hold an outcome — see the last bullet in this
  section.
- **Escalating an audio call to video mid-call.** The one part of video not
  built. It needs renegotiation with glare handling (both sides offering at
  once); the "perfect negotiation" pattern is the known answer. Today you hang
  up and call back with the video button.
- **Nothing adapts to a bad connection.** No resolution or bitrate ceiling is
  set, so a weak uplink degrades however the browser decides. Worth a
  `scaleResolutionDownBy` / `maxBitrate` pass on the video sender before this
  meets a real mobile network.
- **No picture-in-picture or backgrounding.** Leaving the tab keeps the call up
  and the audio flowing, but the video surface is gone until you return.
- **Group calls need an SFU.** Mesh peer-to-peer collapses past ~4 participants,
  so the call button is hidden for groups rather than present and broken.
  LiveKit or Daily remains the sane answer if group calls are ever wanted — and
  note an SFU sees the media, so group calls would NOT inherit the end-to-end
  property 1:1 calls get for free.
- **The `calls` table still only records that a call happened.** No duration, no
  outcome, nothing in the thread. Missed-call history would go here.

## 2. Earnings — DROPPED, 2026-08-09

Removed outright by `0007_drop_earnings.sql`. **Full write-up in
`FOLLOWUPS-CLOSED.md` §2** — the economics, the fraud surface, and why it should
not come back in this shape.

One live detail stays here: **citrus (`--accent`) survives in the palette,
deliberately.** It was introduced for Earn and now carries the online dot, the
add-contact button and "username is available". It is a fill, not a brand colour.
See `src/index.css`.

## 3. End-to-end encryption — product decision

**There is a plan now: `docs/E2E-ENCRYPTION.md`, written 2026-08-16.** It costs
this out against the app as it actually stands — which features stop working,
which decisions are product calls rather than cryptographic ones, and a staged
path. Read that rather than this section before deciding anything.

The short version of its recommendation: **do it before there are users, or
decide not to do it.** Every message in the database is plaintext today and
there is no migration from plaintext history to ciphertext anyone can read, so
the cost only grows. And the real question is not technical — it is whether
HeyChat is a product whose point is privacy, or a messenger that happens to be
self-hosted. Until that is answered, the honest UI claim is the current one:
"Encrypted in transit."

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

## 7. Username changes would orphan the auth user — CLOSED, 2026-08-19

Supabase Auth keys users by email and this app has none, so every account got a
synthetic address built from its username. Login re-derived it to find the user,
which meant the username was not a display name — **it was the primary key of
the auth record**. Renaming one would have left the account unreachable by
password and by recovery phrase alike, because neither is what the lookup uses.

`0026_auth_email.sql` stores the address on `accounts.auth_email` and login looks
it up. New accounts get `<uuid>@<domain>`, so a name and an identity now have
nothing to do with each other; a rename is one column.

**The backfill copies `auth.users`, it does not re-derive.** Rebuilding the
address in SQL would have baked in that file's idea of the domain — and the
domain is configurable, lowercasing has changed shape before, and one mismatched
row is an account nobody can ever sign into again. Verified after applying:
7 of 7 accounts resolve to exactly the address GoTrue holds.

**No auth user was rewritten.** Existing accounts keep their username-derived
address forever, which is fine because it is now opaque data rather than a
formula anybody re-computes. That avoided a migration that could have locked
real people out for a cosmetic gain.

**The resolver must not short-circuit on an unknown name.** The login route's
enumeration defence is that a wrong username and a wrong password produce the
same message in a similar amount of time, so `resolveAuthEmail` always does one
lookup and always returns something to attempt — an unknown name falls through
to the derived address and fails at GoTrue exactly as a wrong password does.

**A consequence worth knowing:** `HEYCHAT_SYNTHETIC_EMAIL_DOMAIN` now only
affects accounts created *after* this migration. Existing identities are stored,
so changing it no longer locks anyone out — it just means new and old accounts
carry different domains, which nothing cares about.

The e2e suite renames an account, logs in under the new name, checks the old
name stops working, and checks GoTrue still holds the address it was created
with. It also caught its own helper: `signedInClient` composed the address from
the username and broke on the first run — the same failure a rename would have
caused, reproduced by the change that fixes it.

## 8. Retire the shim — CLOSED, 2026-08-18

`src/api/base44Client.js` and `src/lib/shim/` are **deleted**. Every screen talks
to Supabase directly or through a named helper in `src/lib/`. Nothing imports
`base44` any more, and there is no `TABLES` map to add an entity to.

**What replaced it.** Six modules, each named after what it is for rather than
after a table:

| Module | Replaces |
|---|---|
| `lib/accounts.js` | `Account.get / filter / update` |
| `lib/contacts.js` | `ContactRequest.*` |
| `lib/conversations.js` (extended) | `Conversation.get / filter / create / update` |
| `lib/messages/read.js` | `Message.filter` |
| `lib/reports.js` | `Report.create` |
| `lib/calls/records.js` | `Call.create` |
| `lib/media/upload.js` | `integrations.Core.UploadFile` (moved out of `lib/shim/`) |

**The N+1 reads went with it.** The shim had no way to say "these ids", so every
list looped `Account.get` and paid a request per person: Contacts made 1 + 3N,
the group create dialog 2 + N, ChatView one per group member. `getAccountsById`
returns a Map from one `in` query, and those screens are now a fixed number of
reads regardless of how many people are in them.

**ChatView's two channels became one, debounced.** `Message.subscribe()` opened a
channel carrying EVERY message row in the database and discarded the ones for
other conversations in the browser — a firehose with a client-side filter. It is
now `conversation_id=eq.<id>` server-side, on the same channel as reactions, with
a 120ms debounce so a burst of reaction rows causes one refetch rather than one
per row. It also does `realtime.setAuth` before subscribing, which the shim's
`subscribe()` never did.

**Two pieces of dead Base44 code surfaced on the way.** `PageNotFound` called
`base44.auth.me()`, which the shim did not define — so it threw on every render,
the catch swallowed it, and the "the AI hasn't implemented this page yet" note it
guarded was unreachable. Both are gone. `ResetPassword.jsx`, named in this
section's old text as the last `base44.auth` caller, no longer exists.

### Still open

- **`CallOverlay` is dead code that still has a route.** It predates real calls:
  it renders your own camera with no peer connection at all. It was migrated off
  the shim rather than deleted because deleting `/call/:conversationId` is a
  product decision, not plumbing. Real calls are `lib/calls/controller.js`.
- **Contact search still only sees one page of accounts.** `ContactSearch` fetches
  20 rows and filters them in the browser, so somebody outside those 20 cannot be
  found by typing their name. This is not a translation artefact — it is exactly
  what `Account.filter({}, null, 20)` did, preserved deliberately because this
  pass was plumbing. The fix is one `ilike` in `lib/accounts.js`; see §9.
- **Screens are still client-side React Router**, mounted under the catch-all.
  Retiring the shim was a prerequisite for moving them to real App Router routes,
  not the move itself.

## 14. Moderation — DONE, 2026-08-19

Reports have been written since 0001 and **nothing ever read them**. There was no
queue, no admin — every account was `role = 'user'`, so `is_admin()` had never
once returned true — and no way to do anything to an account even if someone had
looked. Reporting filed paperwork into a drawer with no handle. Both stores
expect a review process for user-generated content.

`0027_moderation.sql` adds suspension, an index for the queue, and a
`moderation_actions` audit table. `/admin/reports` is the queue; the two routes
behind it are `GET /api/admin/reports` and `POST /api/admin/moderate`.

**Four actions, and the difference is deliberate.** `dismissed` (nothing was
wrong), `reviewed` (looked at, no action), `suspended` (closes the report as
`actioned`), `unsuspended`. Every one writes to `moderation_actions` **before**
it takes effect, so an action that fails halfway still leaves a record that it
was attempted.

**A non-admin gets 404, not 403 and not an empty list.** There is no reason to
confirm to a stranger that a moderation surface exists.

**0028 exists because the role was unreachable.** `accounts_protect_role` (0002)
refused any change to `accounts.role` unless `is_admin()`, and `is_admin()` is
false for the service role too — it keys off `auth.uid()`, which a service-role
request does not have. With no admin in the table it was false for everyone, so
**the first admin could never be created, by anyone, from anywhere.** Invisible
until something tried to use the role. The trigger now skips when there is no
`auth.uid()`; a signed-in user still cannot touch the column, and the e2e suite
asserts that directly. `npm run admin:grant -- <username>` is the only way in,
on purpose: an app that can promote its own users has an escalation surface.

### What suspension actually does

Sets `suspended_at`, which the login route refuses a session for, and revokes
refresh tokens so no existing session can renew. **The access token already in a
browser stays valid until it expires — usually an hour.** Closing that gap means
a database read in front of every query in the app. The moderation screen says
so rather than implying the door slams instantly.

The login check happens **after** the password, not before: checking first would
answer "is this account suspended" to anyone who typed a username.

### Still open

- **Nothing is done to the reported content.** Suspension stops the account;
  the messages it already sent stay where they are. Deleting them is a bigger
  decision — the other party's copy is theirs too (see §9 on why nobody can
  delete a direct conversation).
- **No appeal path.** A suspended person is told they are suspended and why,
  and has nowhere to reply.
- **One admin is a single point of failure**, and cannot suspend themselves,
  which is a guard rather than a plan.

## 9. Smaller items

**Still open:**

- ~~**Contact search only ever sees 20 accounts.**~~ **Fixed 2026-08-19.**
  `ContactSearch` and the group-invite search both go through
  `searchAccounts()` in `lib/accounts.js` now, which asks Postgres with `ilike`
  on username and display name and excludes yourself — or the people already in
  the group — in the query rather than after it, so the row limit is spent on
  results the caller can use.

  **Search terms are sanitised, and the reason is the query grammar.**
  `or=(username.ilike.…,display_name.ilike.…)` is one query-string parameter
  PostgREST parses itself, so a comma ends the filter early and a bracket closes
  the group — either silently changes the query rather than failing. `%` and `*`
  are stripped too: typing one should not quietly match every account.

  **`_` is still a single-character wildcard, and escaping it does not work.**
  Measured against this project: `%test\_%` and `%test_%` both return
  `testbuddy`, `Testerbot` and `Test456`, so the backslash is not honoured and
  an "escape" would be a comment claiming something untrue. Searching `pw_a`
  therefore also matches `pwXa`. A search box returning a superset is a much
  better failure than the one this replaced.

  **The suite's existing "A can find B by username search" passed throughout the
  bug**, because the accounts it creates are among the handful that exist. The
  new assertion checks the *request* instead: if it carries an `ilike` filter,
  the database did the matching and the page size stopped mattering.

- **A sent contact request had no home — fixed 2026-08-18.** The "Sent" tick was
  a `sentTo` object in `ContactSearch` state, so it lived exactly as long as the
  page did. Sign out, sign back in, and every request you had ever sent read as
  though it had been cancelled. Pressing Add again did nothing at all: with a
  `unique (from_account_id, to_account_id)` constraint on the table,
  `sendRequest` found the existing row and returned silently — a button that
  looked broken rather than already-pressed.

  The status is read from the database now, and Contacts has a **Sent** list
  under Requests with a Withdraw button. Two details are load-bearing:

  - **Withdraw DELETES the row rather than marking it cancelled.** The unique
    constraint means any row left behind in any status blocks that pair
    forever, and the failed insert would happen somewhere the user cannot see.
  - **A declined request is REUSED, not re-inserted.** Same constraint. Asking
    again is allowed — the alternative is one decline locking you out silently,
    and the sender is never told a decline happened.

- **A profile photo did not appear when you picked it — fixed 2026-08-18.** The
  stored value is a private storage key, and `/api/media/sign` deliberately
  refuses to sign a key that no account yet lists as its avatar. So between
  picking a photo and pressing "Save Changes" there was nothing renderable at
  all, and the initial stayed put — indistinguishable from an upload that had
  failed. Two changes: the picked file is shown immediately from a local object
  URL (`Avatar` takes a `previewUrl` that short-circuits signing), and the
  avatar is **saved on pick** rather than on Save, so it is real everywhere at
  once. Uploads now also report their own failures instead of only reaching the
  console, and refuse non-images and anything over 8 MB.

  Note for whoever tests this next: the preview appears *before* the upload
  finishes, so reloading on the preview cancels the save. That is a race in the
  test, not in the app — wait for `[aria-label="Uploading photo"]` to go.

- **Storage panel in Settings — added 2026-08-18.** Reports
  `navigator.storage.estimate()` and clears Cache Storage, cache-shaped
  localStorage keys and the in-memory signed-URL map, keeping preferences and
  the session. **It is deliberately honest about its limits:** downloaded photos
  live in the browser's own HTTP cache, which no page is allowed to evict, and
  messages live on the server — so there is no local message store to prune and
  clearing loses nothing. If reclaiming device space becomes a real need rather
  than a worry, the lever is disappearing messages, not this panel.

- **"Remember my username" on the login screen — added 2026-08-18.** The
  username only, written only after a login that actually worked, so a typo is
  not helpfully retyped forever. **Never the password:** that would put a
  reusable credential in localStorage for an account whose only recovery path is
  a recovery password. It is not a "stay signed in" — the session cookie already
  does that.

- **Deleting a chat and unfriending — added 2026-08-16.** "Delete chat" hides a
  conversation for you (`0023_conversation_hides.sql`), recording *when* rather
  than a flag, so the thread you deleted stays deleted and a later message
  brings the chat back carrying only what arrived since. Unfriending removes the
  accepted `contact_requests` row in either direction; it does not delete the
  conversation and does not block, both of which are separate controls.

  **0023 also closed a loaded gun.** `conversations_delete_owner` from 0002 let
  EITHER party to a direct chat DELETE the conversation row, and
  `messages.conversation_id` cascades — so one person could destroy the other's
  entire history, permanently, with nothing to recover from. No screen offered
  it, which is the only reason it had never happened; wiring a "Delete chat"
  button to the obvious thing would have shipped exactly that. The direct clause
  is gone, so a direct conversation is now deleted by nobody.
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
- ~~**Two credentials need rotating.**~~ **Done 2026-08-19.** The database
  password was reset, and the project moved off legacy `anon`/`service_role`
  JWTs onto publishable/secret keys — which avoided rotating the JWT secret and
  so logged nobody out. The exposed secret key was revoked.

  **It went wrong once on the way, and the lesson is in `next.config.mjs`.** The
  publishable and secret keys were swapped in Vercel, so the secret was inlined
  into the browser bundle and shipped. Nothing here caught it; Supabase did,
  refusing the request with "Forbidden use of secret API key in browser". The
  build now refuses outright if any `NEXT_PUBLIC_*` variable holds an
  `sb_secret_` value.

  **Two swallowed errors made it take three attempts.** `/api/auth/register`
  discarded `signInError.message` behind "Account created, but sign-in failed",
  and `resolveAuthEmail` fails soft by design — so a dead secret key still
  produced an ordinary-looking login error. Server-side probes were reassuring
  and wrong; registration was the only honest test. Both paths now surface the
  underlying reason.
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
- **A new contact request now badges the Contacts tab** (2026-08-17), counted
  together with pending group invitations by `src/lib/pending.js` — the same
  tiny-store shape as `unread.js`, published by `AppLayout` because the badge
  must appear wherever you are rather than only on the Contacts screen. Contact
  requests and group invitations both update live —
  `0024_group_invites_realtime.sql` put `group_invites` on the publication,
  which 0019 had missed in exactly the way 0012 missed `message_reactions`.
  Second time this has caught the project: subscribing to an unpublished table
  succeeds, joins cleanly, raises nothing, and never fires.
- **Deleting a message does not clear the notification** already on someone's
  lock screen. The service worker would need to close notifications by tag.
- ~~The conversation-list realtime channel never received row data.~~ **Fixed
  2026-08-17.** It created and subscribed its channel synchronously at the top
  of the effect, before supabase-js had applied the session token to the
  socket — so Realtime evaluated RLS unauthorised and every payload arrived as
  `{ new: {}, errors: ['Error 401: Unauthorized'] }`.

  **It hid for months because the handler was `reload`, which ignores its
  argument.** The list refetched and looked perfect. It only surfaced when the
  arrival sound needed `payload.new.sender_id` to tell your own message from
  someone else's, and got `undefined`. ChatView's channels were unaffected by
  luck rather than design — they open after two awaits, by which point the token
  is set. The session is now fetched and `realtime.setAuth()` called before the
  channel exists, and the browser suite asserts the sound fires, which can only
  happen if the payload carries real columns.
- ~~The sender does not see their own message until realtime delivers it.~~
  **Fixed 2026-08-17.** `deliver()` appends the row `/api/messages` returns and
  lets the realtime reload reconcile, so the composer no longer depends on a
  websocket for something it already has. Safe against the reload that follows:
  `loadMessages()` replaces the array wholesale from the database, which by then
  contains the row, and an id guard covers the race where realtime wins first.

  It was found rather than theorised — two browser-suite assertions went red on
  a run where every `POST /api/messages` returned 200 and the message simply
  never rendered.
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
