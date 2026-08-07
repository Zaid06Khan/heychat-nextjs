import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const [, , connString, ...files] = process.argv;

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
