# HeyChat — Next.js + Supabase

Self-hosted port of the Base44 HeyChat prototype, on a Postgres database and
auth you control.

**Read `FOLLOWUPS.md` before shipping.** The short version: **video calls have
never worked** and the entry point is hidden; **there is no end-to-end
encryption** and message bodies are readable by the server; and **there are no
push notifications**, so you find out about a message when you next open the
app. The watch-and-earn feature was **removed** in `0007` — see FOLLOWUPS §2.

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

> **The command above is for a fresh database.** These migrations are not
> idempotent — `0001` fails with `type "account_role" already exists` on a
> database that already has them. There is no migrations table tracking what has
> run, so on an existing project pass only the new file:
>
> ```bash
> node scripts/migrate.mjs "$DATABASE_URL" supabase/migrations/0007_drop_earnings.sql
> ```
>
> Each file runs inside a transaction and rolls back on error, so a mistake here
> is loud rather than destructive. Real migration tracking is worth adding before
> this list gets much longer.

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
asserts the boundaries hold, and deletes the users. **57 assertions**, covering:

- non-participants can't read a conversation, and nobody can send as someone else
- `account_secrets` is unreachable and a user can't self-promote to admin
- the Earn surface is gone — no `earnings` table, no rate card, no
  `credit_earning()` — so a database that skipped `0007` fails loudly
- attachments can't be fetched by a signed-out stranger, are signed only for
  people in the conversation, and pre-`0006` absolute URLs still resolve
- push subscriptions are unreachable by any client, and `/api/push/notify`
  refuses non-participants, non-senders, signed-out callers and replayed ids
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

**46 assertions, and it is not the same thing as `test:e2e`.** That suite talks
to Supabase directly and proves the boundaries hold; it never renders a
component. This drives the real UI in two browser contexts as two real users —
register, contact request, accept, send, typing indicator, reaction, reply,
edit, delete, mute, conversation list — and fails on any unexpected console
error.

On its first run it found two bugs that a passing build, 57 backend assertions
and a review had all missed: a message menu clipped out of view by its scroll
container, and a realtime channel that threw on every page load in development.
**Compiling is not running**, and that is the gap this closes.

Two browser *contexts* rather than two browsers, deliberately: the device
fingerprint comes from user-agent, screen size, canvas and timezone, so both
contexts produce the same one and both accounts can sign in. A genuinely
different browser would fail the device check — which is also why you must
*register* a second account when testing by hand, not log an existing one in.

The last section runs at **390×844** and is the only thing that has ever
rendered this mobile-first app at phone width. It asserts no horizontal overflow
on `/home`, `/chat`, `/settings` and `/contacts`, that exactly one bottom nav is
visible, and that the message action menu stays inside the viewport for both
sent and received messages. It needs its own account, because a phone-sized
context produces a different fingerprint and cannot sign in as a desktop one —
see `FOLLOWUPS.md` §6, which is a bigger deal than it sounds.

Push **delivery** is out of reach here: headless Chromium reports
`Notification.permission` as `denied`, so the app correctly declines to register
the worker. That path needs real Chrome — turn notifications on in Settings,
then `npm run push:test -- <username>`.

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
| `api/push/notify` | route handler | decides who gets buzzed, and composes the text |

**The sender's browser asks for the notification** (`POST /api/push/notify`
with a message id) after its message lands, because messages are still written
straight from the browser through the compatibility shim. The caller supplies
only an id: the route reads the message through *their own session* so RLS
decides visibility, requires that they are its sender, ignores anything older
than a minute so a captured id can't be replayed, and composes the notification
text server-side from the stored row. Nothing in the request body reaches
anyone's lock screen, and blocked senders are filtered out.

The consequence is worth knowing: if the sender's tab dies between the insert
and that call, the message is delivered but silent. That is the pre-existing
behaviour, not a new failure. When sending moves behind a real route handler
(FOLLOWUPS §8), the notify call belongs inside it and the route should go away.

`push_subscriptions` has **no policy and no grant** for clients — an endpoint
plus its key pair is a capability to push to that device. Every write goes
through a route handler acting on the caller's session, and "am I subscribed?"
is answered by the browser's own service worker, not the database.

> **Rotating the VAPID keys unsubscribes everyone.** A browser binds its
> subscription to the public key that created it, so after a rotation every
> stored endpoint starts being rejected and each device stays silent until its
> next app start re-subscribes it.

On iPhone, web push only reaches **installed** PWAs — Safari delivers nothing
until HeyChat is added to the home screen. The Settings panel says so.

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

HeyChat collects no email and no phone. Supabase Auth requires an email, so each
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
