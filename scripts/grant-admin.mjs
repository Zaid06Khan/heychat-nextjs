/**
 * Grant or revoke the admin role.
 *
 *     npm run admin:grant -- <username>
 *     npm run admin:grant -- <username> --revoke
 *
 * THE ONLY WAY IN. There is deliberately no in-app control for this: an app
 * that can promote its own users has a privilege-escalation surface, and the
 * role is meant to belong to whoever runs the deployment rather than to anyone
 * who uses it. `accounts_protect_role` refuses the change for any signed-in
 * user, which is why this needs the service-role key and not a session.
 *
 * Admin buys two things today, both from 0027: reading the reports queue, and
 * acting on it (dismiss, mark reviewed, suspend, unsuspend).
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const args = process.argv.slice(2);
const revoke = args.includes('--revoke');
const username = args.find((a) => !a.startsWith('--'));

if (!username) {
  console.error('Usage: npm run admin:grant -- <username> [--revoke]');
  process.exit(1);
}

if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.NEXT_PUBLIC_SUPABASE_URL) {
  console.error('.env.local needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: account } = await admin
  .from('accounts')
  .select('id, username, role')
  .eq('username', username)
  .maybeSingle();

if (!account) {
  console.error(`No account called "${username}".`);
  process.exit(1);
}

const role = revoke ? 'user' : 'admin';

if (account.role === role) {
  console.log(`${account.username} is already ${role}. Nothing to do.`);
  process.exit(0);
}

// `.select()` matters: without it a refused update is a 200 with no rows, and
// this would report success for a change that did not happen.
const { data: updated, error } = await admin
  .from('accounts')
  .update({ role })
  .eq('id', account.id)
  .select('username, role');

if (error) {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
}

if (!updated || updated.length === 0) {
  console.error('Refused — no row was changed. Is 0028 applied?');
  process.exit(1);
}

console.log(`${updated[0].username} is now ${updated[0].role}.`);
if (!revoke) console.log('They can open Settings → Reports.');
