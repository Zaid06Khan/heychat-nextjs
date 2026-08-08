import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const [, , connArg, ...files] = process.argv;

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

if (!connString) {
  console.error(
    'No connection string. Pass one as the first argument, or set DATABASE_URL.\n' +
    '  DATABASE_URL="postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres" npm run db:migrate'
  );
  process.exit(1);
}

const client = new Client({
  connectionString: connString,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log('connected');

for (const file of files) {
  const sql = readFileSync(file, 'utf8');
  const name = file.split(/[\\/]/).pop();
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('commit');
    console.log(`OK   ${name}`);
  } catch (err) {
    await client.query('rollback');
    console.log(`FAIL ${name}`);
    console.log(`     ${err.message}`);
    if (err.position) {
      const pos = Number(err.position);
      const upto = sql.slice(0, pos);
      const line = upto.split('\n').length;
      console.log(`     at line ${line}: ${sql.split('\n')[line - 1]?.trim()}`);
    }
    if (err.hint) console.log(`     hint: ${err.hint}`);
    if (err.detail) console.log(`     detail: ${err.detail}`);
    process.exitCode = 1;
    break;
  }
}

await client.end();
