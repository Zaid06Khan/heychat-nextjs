import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Client } from 'pg';

/**
 * Applies migrations, and remembers which ones it has already applied.
 *
 *   node scripts/migrate.mjs <conn>                 apply everything pending
 *   node scripts/migrate.mjs <conn> --status        list applied vs pending
 *   node scripts/migrate.mjs <conn> --baseline      adopt an existing database
 *   node scripts/migrate.mjs <conn> [files...]      restrict to specific files
 *
 * WHY THE TRACKING TABLE EXISTS. Until 2026-08-14 there was none: the files
 * were applied by hand, nothing recorded what had run, and 0001-0006 are not
 * idempotent — so re-running from the start failed with `type "account_role"
 * already exists`, and the only defence was remembering. FOLLOWUPS #9 said to
 * fix it "before the list gets longer". The list got longer (0016).
 *
 * ADOPTING A DATABASE THAT PREDATES THIS. The live project already has 0001
 * through 0015 in it with no record of the fact, so a first run would try to
 * replay them and fail on the first one. `--baseline` writes the ledger rows
 * WITHOUT executing anything, which is the one operation that can lie about
 * reality — so it is explicit, it is never implied, and it prints what it did.
 *
 * Do this once, then migrate normally:
 *   node scripts/migrate.mjs <conn> --baseline supabase/migrations/00{01..15}*.sql
 *   node scripts/migrate.mjs <conn>
 *
 * THE LEDGER AND THE WORK COMMIT TOGETHER. Each file runs inside one
 * transaction that also inserts its ledger row, so a failure rolls back both.
 * There is no state where a migration half-ran and was recorded as done.
 */

const MIGRATIONS_DIR = 'supabase/migrations';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));

/**
 * Told apart by shape, not by position.
 *
 * Taking "the first positional" as the connection string is wrong the moment
 * there isn't one: `migrate.mjs --plan 0016_x.sql` would eat the filename as a
 * connection string, leave the file list empty, and fall through to globbing —
 * so a command naming ONE migration would quietly plan all sixteen. Anything
 * ending in .sql is a file; anything else is the connection string.
 */
const fileArgs = positional.filter((a) => a.toLowerCase().endsWith('.sql'));
const connArg = positional.find((a) => !a.toLowerCase().endsWith('.sql')) ?? null;

/**
 * npm runs package.json scripts through cmd.exe on Windows, where `$DATABASE_URL`
 * is not a variable — it arrives here as those 14 literal characters, and `pg`
 * then tries to resolve a hostname out of it (`ENOTFOUND base`). Fall back to
 * the environment when the argument is missing or obviously unexpanded, so the
 * documented command works on both platforms.
 */
const connString =
  !connArg || connArg.startsWith('$') || connArg.startsWith('%')
    ? process.env.DATABASE_URL
    : connArg;

/**
 * With no files named, every migration in the directory, in filename order.
 *
 * Globbing rather than a hand-kept list in package.json: that list had to be
 * edited by hand for every new migration and was one omission away from
 * silently skipping a file. The numeric prefix is what defines the order, so
 * sorting the directory *is* the order.
 */
const files = (fileArgs.length ? fileArgs : readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => path.join(MIGRATIONS_DIR, f)));

if (files.length === 0) {
  console.error(`No .sql files found in ${MIGRATIONS_DIR}`);
  process.exit(1);
}

const basename = (f) => f.split(/[\\/]/).pop();
const checksum = (sql) => createHash('sha256').update(sql).digest('hex').slice(0, 16);

// Read and hash before opening a connection, so `--plan` can answer "what would
// you run, in what order" without touching a database. That is the half of this
// script that decides what happens to a live schema, and it is the half that
// can be checked for free.
const local = files.map((file) => {
  const sql = readFileSync(file, 'utf8');
  return { file, name: basename(file), sql, sum: checksum(sql) };
});

if (flags.has('--plan')) {
  console.log(`${local.length} migration(s), in this order:\n`);
  for (const [i, p] of local.entries()) {
    console.log(`  ${String(i + 1).padStart(2)}. ${p.name.padEnd(34)} ${p.sum}`);
  }
  console.log('\nNo database was contacted. Add --status to see which are already applied.');
  process.exit(0);
}

// Checked here rather than at the top so `--plan` works with no credentials at
// all — it is the one mode that genuinely does not need a database.
if (!connString) {
  console.error(
    'No connection string. Pass one as the first argument, or set DATABASE_URL.\n' +
    '  DATABASE_URL="postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres" npm run db:migrate\n' +
    '\nTo see what would run without connecting:  node scripts/migrate.mjs --plan'
  );
  process.exit(1);
}

const client = new Client({
  connectionString: connString,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
} catch (err) {
  // A wrong password or an unreachable host is an ordinary mistake, not a crash.
  // Without this it exits on an unhandled rejection and prints a stack trace
  // with the connection string in it.
  console.error(`Could not connect: ${err.message}`);
  console.error('\nCheck the host and password. To inspect the migrations without a database:');
  console.error('  node scripts/migrate.mjs --plan');
  process.exit(1);
}
console.log('connected');

// The ledger itself is the one thing that cannot be a tracked migration.
await client.query(`
  create table if not exists public.schema_migrations (
    filename   text primary key,
    checksum   text not null,
    applied_at timestamptz not null default now()
  );
  revoke all on public.schema_migrations from public, anon, authenticated;
`);

const { rows: appliedRows } = await client.query(
  'select filename, checksum, applied_at from public.schema_migrations'
);
const applied = new Map(appliedRows.map((r) => [r.filename, r]));

const plan = local.map((p) => {
  const record = applied.get(p.name);
  return { ...p, record, pending: !record };
});

// An already-applied file whose contents have changed since. The migration in
// the database is the old one; the file no longer describes it. Never silently
// re-run — that is how you get a half-applied schema nobody can reason about.
const drifted = plan.filter((p) => p.record && p.record.checksum !== p.sum);
for (const p of drifted) {
  console.log(`WARN ${p.name} has changed since it was applied on ${p.record.applied_at.toISOString().slice(0, 10)}`);
  console.log('     The database has the OLD version. Migrations are a history — add a new file instead.');
}

if (flags.has('--status')) {
  for (const p of plan) {
    const mark = p.pending ? 'PENDING' : `applied ${p.record.applied_at.toISOString().slice(0, 10)}`;
    console.log(`  ${p.pending ? '·' : '✓'} ${p.name.padEnd(34)} ${mark}`);
  }
  const pending = plan.filter((p) => p.pending).length;
  console.log(`\n${plan.length - pending} applied, ${pending} pending`);
  await client.end();
  process.exit(0);
}

if (flags.has('--baseline')) {
  let marked = 0;
  for (const p of plan) {
    if (p.record) {
      console.log(`SKIP ${p.name} (already recorded)`);
      continue;
    }
    await client.query(
      'insert into public.schema_migrations (filename, checksum) values ($1, $2)',
      [p.name, p.sum]
    );
    console.log(`MARK ${p.name} — recorded as applied, NOT executed`);
    marked += 1;
  }
  console.log(`\n${marked} recorded without running. Verify this matches reality.`);
  await client.end();
  process.exit(0);
}

let ran = 0;
for (const p of plan) {
  if (!p.pending) {
    console.log(`SKIP ${p.name} (applied ${p.record.applied_at.toISOString().slice(0, 10)})`);
    continue;
  }

  try {
    await client.query('begin');
    await client.query(p.sql);
    await client.query(
      'insert into public.schema_migrations (filename, checksum) values ($1, $2)',
      [p.name, p.sum]
    );
    await client.query('commit');
    console.log(`OK   ${p.name}`);
    ran += 1;
  } catch (err) {
    await client.query('rollback');
    console.log(`FAIL ${p.name}`);
    console.log(`     ${err.message}`);
    if (err.position) {
      const pos = Number(err.position);
      const upto = p.sql.slice(0, pos);
      const line = upto.split('\n').length;
      console.log(`     at line ${line}: ${p.sql.split('\n')[line - 1]?.trim()}`);
    }
    if (err.hint) console.log(`     hint: ${err.hint}`);
    if (err.detail) console.log(`     detail: ${err.detail}`);
    console.log('\n     Nothing was recorded for this file — the transaction rolled back.');
    console.log('     If this database predates migration tracking, you may need --baseline first.');
    process.exitCode = 1;
    break;
  }
}

if (!process.exitCode) console.log(`\n${ran} applied, ${plan.length - ran} already up to date`);
await client.end();
