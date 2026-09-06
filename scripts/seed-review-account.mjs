/**
 * Create the account Google Play's reviewer signs in with.
 *
 * WHY THIS EXISTS AT ALL. Play's "App access" section needs working
 * credentials for anything behind a login, and "just sign up, it's free" is not
 * good enough here for three reasons that are specific to this app:
 *
 *   1. Registration is rate limited to 20/hour/IP. Reviewers work behind shared
 *      infrastructure, and a 429 at signup is indistinguishable from a broken
 *      app.
 *   2. Registration demands a recovery password, which is an unusual step
 *      somebody evaluating the app has no reason to expect.
 *   3. A messenger with no contacts shows nothing. A reviewer landing in an
 *      empty account cannot see conversations, blocking, or reporting — and
 *      reporting is exactly what they check on a user-generated-content app.
 *
 * So the account ships with a real conversation already in it.
 *
 * NOT testbuddy. That account and its conversation are load-bearing for the
 * test suites, and a reviewer poking at it is not a risk worth taking. This
 * creates a separate account and talks TO testbuddy, which is what testbuddy is
 * for.
 *
 * IDEMPOTENT. Re-running it does not create a second account or duplicate the
 * conversation; it reports what already exists. The one thing it cannot do on a
 * re-run is tell you the password again — that is only knowable at creation, so
 * pass your own as the second argument if you need it to be reproducible.
 *
 *   node scripts/seed-review-account.mjs [appUrl] [password]
 *   npm run seed:review
 *
 * The app URL defaults to localhost:3000, which is fine and in fact preferable:
 * the dev server writes to the SAME Supabase project as production, so the
 * account it creates is the one the deployed app sees, without spending
 * production's rate limit.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;
const APP = process.argv[2] || 'http://localhost:3000';

const REVIEW_USERNAME = 'play_review';
const PARTNER_USERNAME = 'testbuddy';

/**
 * Readable on purpose. A human types this into the Play Console by hand, and a
 * transcription error there costs a review cycle. Still 60+ bits from the
 * random block, which is plenty for an account holding nothing.
 */
function makePassword() {
  return `CalamusReview-${randomBytes(6).toString('hex')}`;
}

const password = process.argv[3] || makePassword();
const generated = !process.argv[3];

const admin = createClient(URL, SVC, { auth: { persistSession: false } });

const say = (msg) => console.log(msg);

async function findAccount(username) {
  const { data } = await admin
    .from('accounts')
    .select('id, username, display_name')
    .eq('username', username)
    .maybeSingle();
  return data || null;
}

// --- the reviewer's account ----------------------------------------------

let review = await findAccount(REVIEW_USERNAME);
let createdNow = false;

if (review) {
  say(`  account ${REVIEW_USERNAME} already exists (${review.id})`);
} else {
  // Through the real route, not a direct insert. Registration also writes
  // accounts.auth_email and the bcrypt recovery hash in account_secrets; an
  // account assembled by hand would be missing both and would fail to log in
  // in a way that looks like a server fault.
  const res = await fetch(`${APP}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: REVIEW_USERNAME,
      password,
      display_name: 'Play Review',
      recovery_password: makePassword(),
    }),
  });
  const json = await res.json().catch(() => null);

  if (res.status !== 200) {
    console.error(`\n  FAILED to register ${REVIEW_USERNAME}: ${res.status} ${json?.error || ''}`);
    console.error(`  Is the app running at ${APP}?`);
    process.exit(1);
  }

  review = await findAccount(REVIEW_USERNAME);
  createdNow = true;
  say(`  created ${REVIEW_USERNAME} (${review.id})`);
}

// --- who it talks to ------------------------------------------------------

const partner = await findAccount(PARTNER_USERNAME);
if (!partner) {
  console.error(`\n  ${PARTNER_USERNAME} does not exist in this project.`);
  console.error('  It is meant to be permanent — see CLAUDE.md. Nothing was seeded.');
  process.exit(1);
}
say(`  partner ${PARTNER_USERNAME} (${partner.id})`);

// --- the conversation -----------------------------------------------------

const { data: existing } = await admin
  .from('conversations')
  .select('id')
  .eq('type', 'direct')
  .contains('participant_ids', [review.id, partner.id])
  .maybeSingle();

let conversationId = existing?.id;

if (conversationId) {
  say(`  conversation already exists (${conversationId})`);
} else {
  const { data: conv, error } = await admin
    .from('conversations')
    .insert({
      type: 'direct',
      participant_ids: [review.id, partner.id],
      disappearing_timer: 0,
    })
    .select()
    .single();

  if (error) {
    console.error(`\n  FAILED to create the conversation: ${error.message}`);
    process.exit(1);
  }
  conversationId = conv.id;
  say(`  created conversation (${conversationId})`);
}

// --- something to look at -------------------------------------------------

const { count } = await admin
  .from('messages')
  .select('id', { count: 'exact', head: true })
  .eq('conversation_id', conversationId);

if (count > 0) {
  say(`  conversation already has ${count} message(s) — leaving them alone`);
} else {
  // Deliberately dull. This is what a reviewer reads first, and anything
  // jokey or placeholder-looking ("test test test") invites the conclusion
  // that the app is unfinished.
  const script = [
    [partner.id, 'Hey, welcome to Calamus3.'],
    [review.id, 'Thanks! Getting set up now.'],
    [partner.id, 'You can start a call from the button at the top of a chat.'],
    [review.id, 'Found it. The disappearing message timer is in the chat settings?'],
    [partner.id, 'That is the one. Per conversation, not per account.'],
  ];

  const base = Date.now() - script.length * 6 * 60 * 1000;
  const rows = script.map(([sender, content], i) => ({
    conversation_id: conversationId,
    sender_id: sender,
    content,
    message_type: 'text',
    // Both have read everything, so the reviewer opens a tidy conversation
    // rather than one shouting an unread badge at them.
    read_by: [review.id, partner.id],
    created_date: new Date(base + i * 6 * 60 * 1000).toISOString(),
  }));

  const { error } = await admin.from('messages').insert(rows);
  if (error) {
    console.error(`\n  FAILED to seed messages: ${error.message}`);
    process.exit(1);
  }
  say(`  seeded ${rows.length} messages`);
}

// --- what to paste into the Console ---------------------------------------

console.log('\n  ---- Play Console -> App access ----');
console.log(`  Username: ${REVIEW_USERNAME}`);
if (createdNow) {
  console.log(`  Password: ${password}`);
} else if (generated) {
  console.log('  Password: unchanged (this account already existed).');
  console.log('  Re-run with an explicit password only if you also reset it.');
} else {
  console.log(`  Password: ${password} (as supplied; not verified against the account)`);
}
console.log('\n  Instructions field:');
console.log('    Sign in with the username and password above. No email address');
console.log('    or phone number is required. The account already has a');
console.log('    conversation so all messaging, calling, blocking and reporting');
console.log('    features are reachable immediately.');
console.log('\n  Do not delete this account or change its password while a review is open.\n');
