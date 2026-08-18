# Calamuse

Self-hosted port of the Base44 HeyChat prototype, renamed **Calamuse** on
2026-08-16. Next.js 15 (App Router) + React 19,
Supabase for Postgres / Auth / Storage / Realtime, Tailwind + shadcn on Radix.

The app is still a **React Router SPA** mounted by a catch-all route (`ssr: false`).
That was deliberate — it let the backend be replaced without rewriting 30 screens.
Screens move to real App Router routes incrementally.

## Read this first

`FOLLOWUPS.md` is the source of truth for what is broken and what is unfinished.
It has a status index at the top — **read the one section you need by heading,
not the whole file.**

The three that shape most decisions:
- **§1 Video calls have never worked.** No `RTCPeerConnection`, no signalling, no TURN.
  Both people see their own camera. Entry point is hidden.
- **§3 There is no end-to-end encryption.** `messages.content` is plaintext; the server
  reads everything.
- **§6 Device binding was REMOVED on 2026-08-16.** It hashed a browser
  fingerprint, so one account was one device forever — a laptop and a phone differ
  in at least four hashed inputs. Sessions are ordinary now, and Settings lists
  them with per-device sign-out.

## Commands

```bash
npm run dev            # next dev
npm run build          # see gotcha below before running this
npm run lint
npm run test:e2e -- http://localhost:3000       # 117 assertions, backend boundaries
npm run test:browser -- http://localhost:3000   # 64 assertions, real UI, 2 contexts
npm run db:plan        # migrations in order — needs no database
npm run db:status      # what is applied, what is pending
npm run push:keys      # print VAPID env lines
npm run push:test -- <username>
```

## Gotchas that each cost an hour once

- **`next build` kills the running dev server.** Don't run it in the middle of a session.
- **Apply migrations with `node scripts/migrate.mjs`, never the Supabase dashboard.**
  The dashboard once wrote to the wrong database.
- **PostgREST's schema cache lies about whether a migration landed.** A fresh error
  after a successful migration is often the cache, not your SQL.
- **What has run IS tracked now** (`public.schema_migrations`, since 2026-08-14), so
  `npm run db:migrate` applies only what is pending and is safe to re-run. The files
  themselves are still not idempotent, so a database predating the ledger must be
  adopted once with `--baseline` naming the files it already has. `--baseline` refuses
  to run without that list, because recording unapplied work as done is silent and
  permanent.
- **`0004_grants.sql` is not optional.** Without it you get
  `42501 permission denied for table accounts` before RLS is even consulted.
- **The `testbuddy` account and its conversation are deliberate.** Do not clean them up.
- **Registration is rate limited to 20/hour/IP**, and `test:browser` creates four
  accounts per run — roughly five runs an hour before 429s. Counters are in process
  memory, so restarting the dev server clears them.
- **Two suite runs back-to-back can flake.** Not a rate limit — every
  `POST /api/messages` returns 200 and the UI still misses the message, because
  `ChatView` has no optimistic append and waits on realtime. Restart the dev server
  and re-run before believing a send failure. (Signing an existing account into a
  differently-sized context used to be impossible; since §6 it works fine.)

## Layout

```
src/app/                  Next.js App Router
  api/auth/*              registration, login, password reset
  api/messages            send + notify, in one request
  [[...slug]]/page.jsx    catch-all that mounts the SPA
src/screens/              the original screens (was src/pages — Next reserves that name)
src/components/heychat/   the original components
src/api/base44Client.js   compatibility shim  ─┐  scaffolding, being retired (§8)
src/lib/shim/             Supabase behind it  ─┘
src/lib/supabase/         browser / route-handler / service-role clients
supabase/migrations/      the database, 0001–0024
```

### Three Supabase clients, on purpose

| File | Key | Bypasses RLS | Use for |
|---|---|---|---|
| `lib/supabase/client.js` | anon | no | everything in the browser |
| `lib/supabase/server.js` | anon + session cookie | no | route handlers acting as the user |
| `lib/supabase/admin.js` | service role | **yes** | creating auth users, `account_secrets` |

`admin.js` imports `server-only`, so the build fails if it reaches a client bundle.

### The shim is shrinking — don't grow it

New surfaces (mutes, reactions, typing, push, sending) go **straight to Supabase or to a
route handler**, never through `TABLES`. `ChatView` still reads through the shim and that
is the larger remaining half.

## Invariants worth not regressing

These each exist because of a specific bug or a specific attack. Changing them needs a reason.

- **Deleting a message nulls `content` and `media_url`.** `deleted_at` is not a
  visibility flag with the body still underneath.
- **`expiry_at` is derived server-side** from `conversations.disappearing_timer`. The
  browser used to compute it, which let a client send a permanent message into a
  disappearing conversation.
- **`sender_id`, `read_by` and `created_date` from a request body are ignored.**
- **`push_subscriptions` has no client policy and no grant.** An endpoint plus its keys
  is a capability to push to that device.
- **Typing channels are private** (`typing:<conversation_id>`), authorised by RLS on
  `realtime.messages`. Public channels would let any anon-key holder watch and forge.
- **Recipients mark messages read via the `mark_message_read()` RPC, not a table update.**
  `messages_update_sender` is `using (sender_id = auth.uid())`, so a recipient's direct
  update matches zero rows — and PostgREST returns 200 with an empty array, not an error.
  That silently did nothing for months. See §11.
- **Group column updates go through `SECURITY DEFINER` functions.** RLS cannot express
  "this column but not that one", so the UPDATE grant is narrowed to `disappearing_timer`.
- **`authenticated` has NO UPDATE grant on `messages`** (0020). Same reasoning one step
  further: edit, delete-for-everyone and mark-read are each a function. Without this the
  15-minute edit window and the edit history are advisory, since the client could just
  write `content` itself.
- **Joining a group requires accepting an invitation** (0019), and an invite from someone
  you have blocked is refused. `group_add_member` no longer exists.
- **Give Realtime the auth token BEFORE subscribing a channel.** It evaluates RLS
  per subscriber to decide what it may send; subscribe first and every payload comes
  back `{ new: {}, errors: ['Error 401: Unauthorized'] }`. Silent if the handler
  ignores its argument, which is how it survived months in ConversationList.
- **Nobody can delete a direct conversation.** Both parties have a copy and neither owns
  it. "Delete chat" writes a `conversation_hides` row with a timestamp; 0023 removed the
  policy that let either party cascade-delete every message for both people.
- **Every new table must `grant ... to service_role` explicitly.** It bypasses RLS but not
  grants. Three migrations in a row forgot this; the one that mattered made both suites
  read "migration not applied" and silently skip their assertions.
- **A recovery password is REQUIRED at registration** (route, not just the form). There is
  no email on an account and device binding is gone, so it is the only way back in — one
  created without it is unrecoverable.
- **Routes that sign someone in must pass `request` to `getSupabaseRouteClient`.** GoTrue
  stamps the session with the User-Agent of whoever asked, which is this server unless the
  caller's headers are forwarded. Without it every device in the list reads `node`.

## Testing

`test:e2e` and `test:browser` are not the same thing and neither replaces the other.
The first talks to Supabase directly and proves the boundaries hold; it never renders a
component. The second drives the real UI as two real users and fails on any unexpected
console error — on its first run it found two bugs that a passing build, 57 backend
assertions and a review had all missed. **Compiling is not running.**

Both talk to the **real** Supabase project in `.env.local` and create and delete real users.

The last `test:browser` section runs at 390×844 and is the only thing that has ever
rendered this mobile-first app at phone width.

Push *delivery* can't be tested headlessly — Chromium reports `Notification.permission`
as `denied`. That path needs real Chrome.

## Note on the graphify rule

The user-level `CLAUDE.md` says to run `graphify query` before answering codebase
questions. **There is no `graphify-out/` in this repo** — the graph has never been
generated here, so that instruction is a no-op. Either run `graphify .` to create it,
or ignore the rule for this project and use ordinary search.
