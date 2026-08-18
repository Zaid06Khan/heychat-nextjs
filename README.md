# Calamuse — Next.js + Supabase

Self-hosted port of the Base44 HeyChat prototype (renamed Calamuse on
2026-08-16), on a Postgres database and
auth you control.

**Read `FOLLOWUPS.md` before shipping.** The short version: **video calls have
never worked** and the entry point is hidden, and **there is no end-to-end
encryption** — message bodies are readable by the server. Push notifications
*do* work now (§10), and the watch-and-earn feature was **removed** in `0007`
(§2). All migrations through `0021` are applied as of 2026-08-16;
`npm run db:status` is the authority.

## Setup

```bash
npm install
cp .env.local.example .env.local   # fill in your Supabase keys
```

Apply the migrations to your Supabase project, **in order**:

```
supabase/migrations/0001_schema.sql    tables, enums, indexes
supabase/migrations/0002_rls.sql       row level security + helper functions
supabase/migrations/0003_storage.sql   media bucket + upload policies
supabase/migrations/0004_grants.sql    table privileges  <- required, see note
supabase/migrations/0005_earnings.sql  server-side reward amounts
supabase/migrations/0006_private_media.sql  private media bucket
supabase/migrations/0007_drop_earnings.sql  removes the Earn feature again
supabase/migrations/0008_push_subscriptions.sql  Web Push endpoints
supabase/migrations/0009_notification_prefs.sql  mute + hide preview
supabase/migrations/0010_expiry_sweep.sql        server-side disappearing sweep
supabase/migrations/0011_conversation_list.sql   one-query conversation list
supabase/migrations/0012_message_interactions.sql replies, reactions, edit, delete
supabase/migrations/0013_typing_channels.sql     typing-indicator authorisation
supabase/migrations/0014_unread_counts.sql       unread counting in Postgres
supabase/migrations/0015_group_management.sql    add/remove/rename/leave a group
supabase/migrations/0016_message_hides.sql       "delete for me"
supabase/migrations/0017_reactions_realtime.sql  reactions on the live feed
supabase/migrations/0018_device_list.sql         drops device binding
supabase/migrations/0019_group_invites.sql       group invites need consent
supabase/migrations/0020_edit_history.sql        edit window + history
supabase/migrations/0021_service_role_grants.sql service_role grants 0016/19/20 missed
supabase/migrations/0022_recovery_password_status.sql  "do I have a recovery password?"
supabase/migrations/0023_conversation_hides.sql  delete chat (for you only)
supabase/migrations/0024_group_invites_realtime.sql  group invites on the live feed
```

> `0005` then `0007` on a fresh database is a build-then-demolish, which looks
> odd but is correct: the files are a history, not a desired-state description.
> Collapsing them would rewrite migrations already applied to a live database.

Either paste each file into the Supabase dashboard SQL editor, or run them
directly (no Supabase CLI needed):

```bash
DATABASE_URL="postgresql://postgres:<db-password>@db.<project-ref>.supabase.co:5432/postgres" \
  npm run db:migrate
```

> **`0004_grants.sql` is not optional.** Postgres access control has two layers:
> `GRANT` decides whether a role may touch a table at all, and RLS then decides
> which rows. Policies alone get you `42501 permission denied for table accounts`
> before any policy is even consulted.

**What has already run is now recorded**, in `public.schema_migrations`. The
command above applies whatever is pending and skips the rest, so it is safe to
re-run — which it was not before 2026-08-14. The file list is no longer kept by
hand either; the script reads `supabase/migrations/` in filename order, so a new
migration needs no wiring up.

```bash
npm run db:plan        # what would run, in what order — needs no database
npm run db:status      # what is applied, what is pending
npm run db:migrate     # apply everything pending
```

Each file runs in one transaction that also writes its ledger row, so a failure
rolls back both and there is no half-applied-but-recorded state. An
already-applied file whose contents have since changed is reported as drift and
never silently re-run — migrations are a history, so the fix is a new file.

> **A database that predates the ledger has to be adopted once.** These
> migrations are not idempotent: `0001` fails with `type "account_role" already
> exists` against a database that already has it. On a project that was migrated
> by hand, record the existing files as applied *without running them*, then
> migrate normally:
>
> ```bash
> node scripts/migrate.mjs "$DATABASE_URL" --baseline \
>   supabase/migrations/0001_schema.sql ... supabase/migrations/0015_group_management.sql
> npm run db:migrate
> ```
>
> `--baseline` is the one operation here that can lie about reality, so it is
> never implied, it executes nothing, and it prints every row it writes. **It
> also refuses to run without an explicit file list** — baselining the whole
> folder would record migrations nobody has run as done, after which
> `db:migrate` skips them permanently, which is worse than any failure it could
> have prevented. Check the list against what the database actually has.

No email-provider configuration is needed — accounts are created through the
admin API, which does not send or validate confirmation mail.

```bash
npm run dev
```

## Smoke test

With the dev server running:

```bash
npm run test:e2e -- http://localhost:3000
```

Registers three throwaway users, walks register → login → send a message, then
asserts the boundaries hold, and deletes the users. **117 assertions**, covering:

- non-participants can't read a conversation, and nobody can send as someone else
- `account_secrets` is unreachable and a user can't self-promote to admin
- the Earn surface is gone — no `earnings` table, no rate card, no
  `credit_earning()` — so a database that skipped `0007` fails loudly
- attachments can't be fetched by a signed-out stranger, are signed only for
  people in the conversation, and pre-`0006` absolute URLs still resolve
- push subscriptions are unreachable by any client, and `/api/messages` refuses
  signed-out callers and non-participants, ignores a forged `sender_id`,
  `read_by` or `created_date`, applies the disappearing timer even when the
  client omits it, and won't let a reply point into another conversation
- nobody can mute or react on someone else's behalf, the conversation-list RPC
  returns nothing to a non-member, and a deleted message keeps no readable body
- deleting or expiring a message queues its attachment, `/api/cron/sweep-media`
  removes it from storage, and `delete_expired_messages()` really deletes rows

It talks to the **real** Supabase project in `.env.local`, not a fixture, and
creates and deletes real users each run.

### Browser smoke test

```bash
npx playwright install chromium    # once
npm run test:browser -- http://localhost:3000
```

**64 assertions, and it is not the same thing as `test:e2e`.** That suite talks
to Supabase directly and proves the boundaries hold; it never renders a
component. This drives the real UI in two browser contexts as two real users —
register, contact request, accept, send, typing indicator, reaction, reply,
edit, delete, mute, conversation list — and fails on any unexpected console
error.

On its first run it found two bugs that a passing build, 57 backend assertions
and a review had all missed: a message menu clipped out of view by its scroll
container, and a realtime channel that threw on every page load in development.
**Compiling is not running**, and that is the gap this closes.

Two browser *contexts* rather than two browsers, so two accounts can be driven
as two real users in one Chromium. This used to come with a caveat about device
fingerprints matching; device binding was removed on 2026-08-16 (`FOLLOWUPS.md`
§6), so any browser can now sign in to any account with the right password, and
testing by hand no longer means registering a fresh account each time.

The last section runs at **390×844** and is the only thing that has ever
rendered this mobile-first app at phone width. It asserts no horizontal overflow
on `/home`, `/chat`, `/settings` and `/contacts`, that exactly one bottom nav is
visible and that only one is in the DOM, and that the message action menu stays
inside the viewport for both sent and received messages.

It opens by signing a **desktop-registered account in at phone width**, which is
the assertion that proves §6 is closed. That was impossible until 0018: the
fingerprint included screen size, so this section had to register an account of
its own, and a user moving between a laptop and a phone was locked out.

Push **delivery** is out of reach here: headless Chromium reports
`Notification.permission` as `denied`, so the app correctly declines to register
the worker. That path needs real Chrome — turn notifications on in Settings,
then `npm run push:test -- <username>`.

> **It creates four accounts per run**, and `/api/auth/register` allows 20 per
> hour per IP — so roughly five runs an hour before registration starts
> returning 429. The limiter keeps its counters in process memory, so
> restarting the dev server clears them.

## Architecture

```
src/app/                  Next.js App Router
  api/auth/*              server-side auth (registration, login, password reset)
  [[...slug]]/page.jsx    catch-all that mounts the SPA
src/screens/              the original screens (was src/pages — renamed, see below)
src/components/heychat/   the original components, unchanged
src/api/base44Client.js   compatibility shim — same shape the components expect
src/lib/shim/             Supabase implementation behind that shim
src/lib/supabase/         browser / route-handler / service-role clients
supabase/migrations/      the database
```

### Three Supabase clients, on purpose

| File | Key | Bypasses RLS | Use for |
|---|---|---|---|
| `lib/supabase/client.js` | anon | no | everything in the browser |
| `lib/supabase/server.js` | anon + session cookie | no | route handlers acting as the user |
| `lib/supabase/admin.js` | service role | **yes** | creating auth users, `account_secrets` |

`admin.js` imports `server-only`, so the build fails if it is ever pulled into a
client bundle.

### Notifications

Web Push, so a message arrives while the app is closed. **Optional** — leave the
VAPID variables unset and everything else works exactly as before, with the
Settings toggle reporting that push is not configured.

```bash
npm run push:keys     # prints the three env lines to paste into .env.local
```

The pieces:

| Piece | Where | Does |
|---|---|---|
| `public/sw.js` | the browser | shows the notification, opens the conversation on click |
| `lib/push/client.js` | the browser | permission, subscribe/unsubscribe, re-sync on start |
| `lib/push/server.js` | the server | signs and delivers, prunes dead endpoints |
| `api/push/subscribe`,`unsubscribe` | route handlers | store and remove a device's endpoint |
| `lib/push/notifyForMessage.js` | the server | decides who gets buzzed, and composes the text |

**Sending a message is what triggers the notification**, in the same request.
`POST /api/messages` inserts the row through the caller's own session — so
`messages_insert_member` still decides whether they may write into that
conversation — and then calls `notifyForMessage()` from Next's `after()`, which
runs once the response is on the wire but still inside the same server
invocation. The composer never waits on a round trip to FCM, and the
notification is no longer something the sender's tab has to stay alive to ask
for.

That closes the gap this section used to describe. Until 2026-08-14 messages
were inserted by the browser and the notification was a *second* request
(`POST /api/push/notify`) the sending tab had to survive to make; if it didn't,
the message arrived silently with nothing reporting an error. That route is
gone, along with the defensive machinery it needed — visibility checks,
sender checks, a one-minute replay window — all of which existed because the
caller named a message it had not necessarily sent. It cannot name one now.

The notification text is still composed server-side from the stored row, so
nothing in a request body reaches anyone's lock screen, and blocked senders and
muted conversations are filtered out before a push is sent.

`push_subscriptions` has **no policy and no grant** for clients — an endpoint
plus its key pair is a capability to push to that device. Every write goes
through a route handler acting on the caller's session, and "am I subscribed?"
is answered by the browser's own service worker, not the database.

> **Rotating the VAPID keys unsubscribes everyone.** A browser binds its
> subscription to the public key that created it, so after a rotation every
> stored endpoint starts being rejected and each device stays silent until its
> next app start re-subscribes it.

On iPhone, web push only reaches **installed** PWAs — Safari delivers nothing
until Calamuse is added to the home screen. The Settings panel says so.

Two recipient preferences are applied **server-side, before anything is sent**,
because that is the only place they mean anything: a per-conversation **mute**
(`conversation_mutes`, `0009`) drops the push rather than hiding it on arrival,
and **hide message preview** (`accounts.hide_notification_preview`) means the
message text never leaves the server at all.

### Disappearing messages

Expiry is a scheduled server sweep, not a browser one. `delete_expired_messages()`
runs every five minutes under `pg_cron` (`0010`).

Attachments need a second step, and it is worth knowing why. Deleting a message
row does not delete its file — removing bytes from Supabase Storage requires the
Storage API, and Postgres can only reach it with pg_net and a service-role key
stored in the database, which is a worse thing to own than the problem. So the
sweep queues storage keys in `expired_media`, and **`POST /api/cron/sweep-media`**
drains that queue. Point any scheduler at it with `Authorization: Bearer $CRON_SECRET`.
With `CRON_SECRET` unset the route refuses everything rather than defaulting to
open; expired messages still vanish, their attachments just accumulate.

The client still filters expired messages out on render, since a row can outlive
its expiry by up to five minutes.

### Replies, reactions, edit and delete

`0012`. Reactions are their own table keyed `(message_id, account_id, emoji)`,
so one person can add several different emoji but not the same one twice.

**Delete means delete.** `deleted_at` is not a visibility flag with the text
still underneath — the same update nulls `content` and `media_url`, and a trigger
queues the attachment onto the `expired_media` path above. A "deleted" message
whose body is still selectable by every participant is hidden, not deleted.

`reply_to_id` is `ON DELETE SET NULL`, so deleting a message does not take the
replies to it with it; they render as a quote of something unavailable.

### Typing indicators

Realtime broadcast, no table — "X is typing" is true for three seconds and
worthless after, so persisting it would be a write per keystroke for data with
no value at rest.

The channels are **private** (`typing:<conversation_id>`), authorised by RLS on
`realtime.messages` in `0013` using the same `is_conversation_member()` helper
as everything else. On a public channel anyone holding the anon key and a
conversation UUID could watch who was typing and forge it. Private channels fail
closed: without those policies, indicators stop appearing rather than falling
back to public.

### Auth

Calamuse collects no email and no phone. Supabase Auth requires an email, so each
account gets a synthetic non-routable one derived from the username
(`<username>@accounts.heychat.invalid`). Nothing is ever sent to it. The username
remains the real identifier.

Passwords are verified by Supabase Auth with bcrypt, server-side. They are never
hashed in the browser.

The `heychat_session` entry in localStorage is a **cache** so components can read
`getSession().id` synchronously during render. It is not a credential — the real
session is a signed JWT in an httpOnly cookie, and Postgres RLS checks that JWT
on every query. Editing the localStorage value achieves nothing.

### Why `src/pages` became `src/screens`

Next.js reserves `src/pages` for the Pages Router and tried to serve
`Chat.jsx` as a route. Renaming was mandatory; only the import paths in `App.jsx`
changed.

### Why the app is still a React Router SPA

The catch-all route mounts the original app client-side (`ssr: false`). This let
the backend be replaced without rewriting 30 screens at once. Screens should move
to real App Router routes incrementally — see `FOLLOWUPS.md` §8.
