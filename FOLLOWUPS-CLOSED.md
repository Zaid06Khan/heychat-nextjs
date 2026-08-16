# Follow-ups — closed

Sections from `FOLLOWUPS.md` that are finished and carry **no remaining open work**.
They live here so the main file stays about what is still true.

Numbering matches `FOLLOWUPS.md`, which keeps a stub for each one — commit messages
reference these by number.

Sections marked DONE that still carry open gaps (§10, §11, §12, §13) deliberately
stayed in the main file. Being finished is not the same as being inert.

---

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

---

## Closed during the original port

- **#9 `ReportDialog` wiped the block list** — fixed. It read the list from a
  session object that never contained it.
- **#9 No rate limiting on the auth routes** — added, with the per-process caveat
  still noted in `FOLLOWUPS.md` §9.
- **The UI** — rebuilt on a real design system ("Bodega"), and fonts now load
  at all, which they never had.

## Historical notes, for context

- `src/pages/ResetPassword.jsx` was deleted — it called
  `base44.auth.resetPassword` with an emailed reset token, which never applied
  to an app without email addresses.
- `src/components/ui/calendar.jsx` and `chart.jsx` were deleted — unreferenced
  shadcn boilerplate whose dependencies (`react-day-picker@8`, `recharts@2`)
  don't support React 19.
- Request duplication: a browser pass measured 10 Supabase requests to render
  `/home` with one conversation, brought to 7 by memoizing `getCurrentAccount()`.
  The rest was React StrictMode double-invoking effects in dev, plus
  `ConversationList`'s two realtime subscriptions and its N+1 "last message per
  conversation" loop — both since fixed, along with the double-mount that was
  doing all of it twice (§9). Fixing properly means moving these reads into TanStack
  Query (already a dependency) — part of retiring the shim (§8). Note media now
  adds one signing request per distinct attachment, cached per key.
