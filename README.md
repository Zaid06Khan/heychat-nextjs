# HeyChat — Next.js + Supabase

Self-hosted port of the Base44 HeyChat prototype, on a Postgres database and
auth you control.

**Read `FOLLOWUPS.md` before shipping.** The short version: **video calls have
never worked** and the entry point is hidden; **there is no end-to-end
encryption** and message bodies are readable by the server; **there are no push
notifications**; and the **Earn payout figures lose money on every ad**, though
the balance can no longer be forged.

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
```

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
> node scripts/migrate.mjs "$DATABASE_URL" supabase/migrations/0005_earnings.sql
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
asserts the boundaries hold, and deletes the users. **41 assertions**, covering:

- non-participants can't read a conversation, and nobody can send as someone else
- `account_secrets` is unreachable and a user can't self-promote to admin
- earnings can't be minted, the reward rate card is unreadable, and the server —
  not the caller — decides the amount
- attachments can't be fetched by a signed-out stranger, are signed only for
  people in the conversation, and pre-`0006` absolute URLs still resolve

It talks to the **real** Supabase project in `.env.local`, not a fixture, and
creates and deletes real users each run.

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
