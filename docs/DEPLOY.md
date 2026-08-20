# Deploying Calamus3 to Vercel

Written 2026-08-16. The repo is prepared; the steps below need your accounts, so
they have to be run by you.

---

## Before you start — read this one

**Rotate the Supabase `service_role` key and the database password first.**

Both have been pasted into chat transcripts (three times for the password, most
recently today). Locally that was a risk you had decided to park, and that was a
reasonable call. Deploying changes it: the `service_role` key **bypasses every
RLS policy** — it can read and write every account, every message and
`account_secrets` — and you are about to paste it into a production environment
attached to a public URL.

- Supabase dashboard → **Settings → API** → rotate `service_role`
- **Settings → Database** → reset the database password
- update `.env.local`, then set the new values in Vercel (below)

This is the last cheap moment to do it. After there are users, rotating means a
window where the app is broken.

---

## 1. Install the CLI and link the project

```bash
npm i -g vercel
vercel login
vercel link
```

`vercel link` creates `.vercel/` — already covered by `.gitignore`.

## 2. Environment variables

Set each of these for **Production, Preview and Development**:

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public; safe in the browser bundle |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public; RLS is what protects the data |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret.** Bypasses all RLS. Rotate first. |
| `HEYCHAT_SYNTHETIC_EMAIL_DOMAIN` | **do not change the value.** See below. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Web Push |
| `VAPID_PRIVATE_KEY` | **secret** |
| `VAPID_SUBJECT` | e.g. `mailto:you@yourdomain` |
| `CRON_SECRET` | any long random string; the sweep refuses everything without it |
| `TURN_URLS` | optional; comma-separated `turn:`/`turns:` URLs. No relay without it — see `docs/TURN.md` |
| `TURN_STATIC_AUTH_SECRET` | **secret.** The same string coturn's `static-auth-secret` is set to |

**There is deliberately no `NEXT_PUBLIC_TURN_*`.** A relay credential is a
licence to spend bandwidth, so it is minted per-request by `/api/calls/ice` and
expires on its own. Setting a relay password as a `NEXT_PUBLIC_` variable would
publish it in the browser bundle to anyone who opened devtools.

```bash
vercel env add SUPABASE_SERVICE_ROLE_KEY production
# ...repeat per variable, or paste them in the dashboard
```

> **`HEYCHAT_SYNTHETIC_EMAIL_DOMAIN` keeps its old value even though the app is
> now called Calamus3.** Every account's auth user is keyed by
> `<username>@<that domain>`, and login re-derives that address to find them.
> Change it and every existing account becomes unreachable — not by password,
> not by recovery phrase, because neither is what the lookup uses. See the note
> in `src/lib/auth/shared.js` and FOLLOWUPS §7.

## 3. Deploy

```bash
vercel            # preview deployment, safe to throw away
vercel --prod     # production
```

## 4. Afterwards

**Point Supabase at the real origin.** Dashboard → Authentication → URL
Configuration → add the deployment URL to Site URL / Redirect URLs.

**Check the cron.** `vercel.json` schedules `/api/cron/sweep-media` daily at
03:00 UTC. Vercel Cron calls it with **GET** and sends
`Authorization: Bearer $CRON_SECRET` automatically — the route has a `GET`
export for exactly that reason. Verify the first run in the Vercel dashboard
under Cron Jobs; a 401 means `CRON_SECRET` is missing or mismatched, and a 503
means it is not set at all.

**Run the suites against the deployment**, not just locally:

```bash
npm run test:e2e -- https://your-deployment-url
npm run test:browser -- https://your-deployment-url
```

Both create and delete real accounts in the real project, so expect four to
seven throwaway users to appear and disappear.

---

## Things that behave differently once deployed

### The rate limiter gets weaker

`src/lib/auth/rateLimit.js` keeps counters in one process's memory. That is
exact on a single server and approximate on Vercel, where several instances each
enforce their own quota — so "10 logins per 15 minutes per IP" becomes ten *per
instance*. It still bites, but it is no longer the number it claims.

This is the anti-abuse layer on registration and login, so it matters more in
public than it did locally. The fix is a shared store (Upstash Redis, or a
Postgres table); `check()` was written so its signature would not need to change.
See FOLLOWUPS §9.

### Push notifications need HTTPS, which you now have

Web Push only works on a secure origin, so this is the first environment where
push can be tested properly on a phone. On **iOS the app must be added to the
home screen first** — Safari delivers nothing to an uninstalled site.

Note this is also the part that does **not** survive a native app-store build:
inside a WKWebView there is no Web Push, so an iOS/Android wrapper needs APNs
and FCM device tokens instead. Deploying does not get you closer to that; it
gets you a working PWA and a URL the wrapper can point at.

### Cron frequency depends on your plan

The Hobby plan allows daily cron jobs. `0010`'s design has Postgres sweeping
expired message *rows* every five minutes via `pg_cron`, and this route only
drains the leftover *storage objects* — so once a day is tolerable, it just
means an orphaned file can sit in the bucket for up to 24 hours. If you want it
tighter without changing plan, point any external scheduler at the endpoint with
the same Bearer header.

---

## What this does not cover

Deploying gets you a URL. It does **not** get you into the app stores. Still
outstanding for that, none of it code:

- a published **privacy policy** and terms — both stores refuse a listing without a policy URL
- a **moderation process** — `reports` rows are written and nothing reads them; Apple asks how reports are actioned
- **$99/year** Apple Developer, **$25** once for Google Play
- a **Capacitor** wrapper, and native push (APNs + FCM) alongside the existing Web Push
