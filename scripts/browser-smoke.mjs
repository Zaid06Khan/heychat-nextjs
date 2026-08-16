/**
 * Real-browser smoke test.
 *
 *     npm run test:browser -- http://localhost:3000
 *
 * Needs Chromium once:  npx playwright install chromium
 *
 * WHAT THIS IS FOR, and why it is not the same thing as test:e2e. The e2e suite
 * talks to Supabase directly and proves the boundaries hold — who can read
 * what, who can write what. It never renders a single component. This drives
 * the actual UI in a real browser, and on its first run it found two bugs that
 * a passing build, 57 backend assertions and a code review had all missed: a
 * message menu clipped out of view by its scroll container, and a realtime
 * channel that threw on every page load in development.
 *
 * Compiling is not running. That is the gap this closes.
 *
 * TWO BROWSER CONTEXTS, not two browsers, so two accounts can be driven as two
 * real users with separate cookie jars in one Chromium. This used to carry a
 * caveat about both contexts producing the same device fingerprint; device
 * binding was removed on 2026-08-16 (FOLLOWUPS #6), so any browser can sign in
 * to any account with the right password and the caveat is gone.
 *
 * Like the e2e suite, this talks to the REAL Supabase project in .env.local and
 * creates real users. It deletes them again at the end.
 *
 * IT CREATES FOUR ACCOUNTS PER RUN, and /api/auth/register allows 20 per hour
 * per IP — so this can run about five times an hour before registration starts
 * returning 429. The limiter keeps counters in process memory, so restarting
 * the dev server clears them. register() detects the 429 and says so; without
 * that it surfaced as a bare navigation timeout that looked like a broken form.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error(
    'playwright is not installed.\n' +
      '  npm install\n' +
      '  npx playwright install chromium'
  );
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const APP = process.argv[2] || 'http://localhost:3000';
const stamp = Date.now().toString().slice(-6);
const userA = `pw_a_${stamp}`;
const userB = `pw_b_${stamp}`;
const userM = `pw_m_${stamp}`;
const userN = `pw_n_${stamp}`;

// Everything created here gets deleted in the finally block. Tracked in a list
// because the mobile pass creates a second pair of its own — not because it has
// to any more (it now also signs userA in at phone width, which is the point of
// §6 being closed), but so its layout assertions get a conversation the desktop
// assertions are not also reading.
const createdUsers = [userA, userB];
const PW = 'CorrectHorse9';
const RECOVERY = 'RecoveryHorse9';

let pass = 0;
let fail = 0;
const consoleErrors = [];

const check = (ok, label, extra = '') => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${extra ? '  -- ' + extra : ''}`);
  ok ? pass++ : fail++;
};

/**
 * Wait for a condition instead of sleeping and hoping.
 *
 * These replace the fixed `waitForTimeout` calls this file used to be built
 * from. A fixed sleep is wrong in both directions: too short and the suite
 * flakes on a slow round trip, too long and every run pays for the worst case.
 * `seen`/`gone` return a boolean rather than throwing, so a genuine failure is
 * still reported as a FAIL with a label rather than aborting the whole run.
 *
 * The timeouts here are ceilings, not delays — a passing assertion returns as
 * soon as the condition holds, usually in tens of milliseconds.
 */
const seen = (page, selector, timeout = 15000) =>
  page.waitForSelector(selector, { state: 'visible', timeout }).then(() => true).catch(() => false);

const gone = (page, selector, timeout = 10000) =>
  page.waitForSelector(selector, { state: 'hidden', timeout }).then(() => true).catch(() => false);

/**
 * Opens the action menu on the bubble containing `text`.
 *
 * Scoped to that bubble on purpose: taking the last action button in the DOM
 * grabs whichever message is newest, which after a reply is the other person's
 * — and then "Edit" is correctly absent and the test blames the app.
 *
 * `.first()`, not `.last()`, because a reply RENDERS THE QUOTED TEXT inside its
 * own bubble, so a phrase matches both the original and the reply quoting it.
 * The original is earlier in the thread.
 */
const openMsgMenu = async (page, text) => {
  const bubble = page.locator('div.group').filter({ hasText: text }).first();
  // Waits for the bubble to exist rather than assuming the thread has rendered.
  await bubble.waitFor({ state: 'visible', timeout: 15000 });
  await bubble.hover();
  await bubble.locator('button[aria-label="Message actions"]').click({ force: true });
  // The menu, not a guess at how long it takes to appear. Reply is in every
  // variant of the menu — own message or not — so it is the safe thing to wait
  // for; Edit and Delete are conditional on ownership.
  await page.waitForSelector('button:has-text("Reply")', { state: 'visible', timeout: 10000 })
    .catch(() => {});
};

/** The menu's click-away backdrop covers the viewport; any click closes it. */
const closeMenu = async (page) => {
  await page.mouse.click(5, 400);
  await gone(page, 'button:has-text("Reply")', 5000);
};

/**
 * Has this migration been applied?
 *
 * Migrations here are run by hand, so a tree carrying code for one nobody has
 * run yet is a normal state. Assertions about that code would be permanently
 * red, which trains people to ignore the suite — so they are gated on the
 * ledger 0016 introduced. No ledger, or no service key, answers "no", which is
 * the correct assumption in both cases.
 */
const migrationApplied = async (filename) => {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return false;
  const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const { data } = await svc
    .from('schema_migrations')
    .select('filename')
    .eq('filename', filename)
    .maybeSingle();
  return Boolean(data);
};

const watchConsole = (page, who) => {
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[${who}] ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[${who}] PAGEERROR ${String(e).slice(0, 300)}`));
};

// Six fields, all of them `required` — including BOTH recovery-password boxes.
// Leaving those blank makes the browser's native validation block submit with
// no visible error and no network request, which looks exactly like a broken
// signup endpoint. Filled by index because two share the •••••••• placeholder.
const register = async (page, username) => {
  await page.goto(`${APP}/register`, { waitUntil: 'domcontentloaded' });
  const inputs = page.locator('input');
  await inputs.nth(0).fill(username);
  await inputs.nth(1).fill(username);
  await inputs.nth(2).fill(PW);
  await inputs.nth(3).fill(PW);
  await inputs.nth(4).fill(RECOVERY);
  await inputs.nth(5).fill(RECOVERY);
  // The submit button is disabled while the username check is outstanding, so
  // wait for its verdict rather than for a fixed number of milliseconds.
  await seen(page, 'text=Username is available', 15000);

  // Watch the actual response. Without this, a rejected registration surfaces
  // only as "waitForURL timeout" — which says nothing about why, and sent me
  // looking for a bug in the form when the real answer was a rate limit.
  const responded = page
    .waitForResponse((r) => r.url().includes('/api/auth/register'), { timeout: 25000 })
    .catch(() => null);
  await page.click('button[type="submit"]');
  const res = await responded;

  if (res && res.status() === 429) {
    throw new Error(
      'registration is rate limited — 20 accounts per hour per IP ' +
        '(register: in src/lib/auth/rateLimit.js). This suite creates FOUR ' +
        'accounts per run, so it can only run about five times an hour. The ' +
        'limiter keeps its counters in process memory, so restarting the dev ' +
        'server clears them immediately.'
    );
  }
  if (res && !res.ok()) {
    const body = await res.json().catch(() => null);
    throw new Error(`registration failed: HTTP ${res.status()} ${body?.error || ''}`);
  }

  await page.waitForURL(/\/home/, { timeout: 25000 });
};

const browser = await chromium.launch();

try {
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const A = await ctxA.newPage();
  const B = await ctxB.newPage();
  watchConsole(A, 'A');
  watchConsole(B, 'B');

  console.log('\n--- 1. LANDING AND REGISTRATION ---');
  await A.goto(APP, { waitUntil: 'domcontentloaded' });
  await A.waitForSelector('text=/Create Account|Log In/i', { timeout: 20000 });
  check(true, 'the landing page renders (SPA mounts client-side)');

  await register(A, userA);
  check(A.url().includes('/home'), 'user A registers and lands on /home', A.url());

  await register(B, userB);
  check(B.url().includes('/home'), 'user B registers and lands on /home', B.url());

  console.log('\n--- 2. CONTACTS AND CONVERSATION ---');
  await A.goto(`${APP}/contacts`, { waitUntil: 'domcontentloaded' });
  await A.fill('input[placeholder="Search by username..."]', userB);
  check(await seen(A, `text=@${userB}`), 'A can find B by username search');
  await A.locator('button:has-text("Add")').first().click();
  check(await seen(A, 'text=Sent'), 'the request is sent');

  await B.goto(`${APP}/contacts`, { waitUntil: 'domcontentloaded' });
  await B.locator('button:has-text("Requests")').click();
  const hasRequest = await seen(B, 'button[aria-label^="Accept contact request"]');
  check(hasRequest, 'B sees the incoming contact request');
  if (!hasRequest) throw new Error('no contact request — cannot continue to messaging');
  // Accepting is what creates the conversation (Contacts.jsx acceptRequest).
  await B.locator('button[aria-label^="Accept contact request"]').first().click();
  // The accept button disappearing is the signal the request was processed.
  check(await gone(B, 'button[aria-label^="Accept contact request"]'),
    'B accepts, which creates the conversation');

  console.log('\n--- 3. MESSAGING ---');
  await B.goto(`${APP}/home`, { waitUntil: 'domcontentloaded' });
  // Wait for the list to actually contain A rather than for the page to have
  // been open a while — this is the query the conversation-list RPC feeds.
  check(await seen(B, `text=${userA}`), 'the new conversation appears in B\'s list');
  await B.locator(`text=${userA}`).first().click();
  await B.waitForURL(/\/chat\//, { timeout: 15000 });
  const convUrl = B.url();
  check(true, 'B opens the conversation', convUrl);

  await A.goto(convUrl, { waitUntil: 'domcontentloaded' });
  // A must be subscribed before B sends, or the realtime assertion below tests
  // nothing. The composer rendering is the proxy for "ChatView has mounted".
  await seen(A, 'textarea');

  await B.fill('textarea', 'hello from B');
  await B.keyboard.press('Enter');
  check(await seen(B, 'text=hello from B'), 'B sends a message and sees it');

  check(await seen(A, 'text=hello from B'),
    'A receives it over realtime without reloading');

  console.log('\n--- 4. TYPING INDICATOR ---');
  // The reason this file exists in the first place: typing needs two live
  // browsers, so the e2e suite cannot reach it. Private channels fail CLOSED,
  // so if the 0013 policies are missing this silently shows nothing.
  await A.click('textarea');
  await A.type('textarea', 'typing a reply', { delay: 60 });
  check(await seen(B, 'text=/is typing/i', 12000), 'B sees "is typing" while A types');

  const typingWarn = consoleErrors.filter((e) => e.includes('[typing]'));
  check(typingWarn.length === 0, 'no typing-channel refusal in the console', typingWarn[0] || '');

  await A.keyboard.press('Enter');
  // Waits for it to actually go, rather than sleeping past the 4s TTL and
  // asserting after. This also proves the explicit "stopped" broadcast works:
  // a 5s ceiling would not be met by the timeout path alone.
  check(await gone(B, 'text=/is typing/i', 5000),
    'the indicator clears once the message is sent');

  console.log('\n--- 5. REPLIES, REACTIONS, EDIT, DELETE ---');
  await openMsgMenu(A, 'typing a reply');
  check(await A.locator('text=Delete for everyone').isVisible().catch(() => false),
    'the message action menu opens on your own message');

  await A.locator('button:has-text("React")').click();
  await seen(A, 'button:has-text("👍")');
  await A.locator('button:has-text("👍")').first().click();
  check(await seen(A, 'text=👍'), 'a reaction renders on the bubble');

  // Live arrival depends on 0017 having put message_reactions on the realtime
  // publication. A client can subscribe to an unpublished table perfectly
  // happily — the channel joins, no error is raised, and no event ever comes —
  // so the capability is checked against the database rather than inferred from
  // the subscription succeeding. Without it this would be a silent false
  // failure on a tree where the migration simply has not been run yet.
  // Asked of the migration ledger rather than of pg_catalog: PostgREST only
  // exposes the schemas it is configured for, and pg_publication_tables is not
  // one of them.
  if (await migrationApplied('0017_reactions_realtime.sql')) {
    check(await seen(B, 'text=👍', 20000),
      'B sees the reaction live, without reloading');
  } else {
    console.log('  SKIP  live reactions — 0017_reactions_realtime.sql not applied');
    console.log('        run it, then this asserts arrival with no reload');
  }

  // Either way it must survive a reload, which is the weaker promise the app
  // made before 0017 and still makes after it.
  await B.reload({ waitUntil: 'domcontentloaded' });
  check(await seen(B, 'text=👍'), 'and it is still there after B reloads');

  await openMsgMenu(B, 'typing a reply');
  await B.locator('button:has-text("Reply")').click();
  check(await seen(B, 'text=/Replying to/i'), 'the reply composer bar appears');
  await B.fill('textarea', 'this is a reply');
  await B.keyboard.press('Enter');
  check(await seen(B, 'text=this is a reply'), 'the reply sends');
  check(await gone(B, 'text=/Replying to/i'), 'and the reply bar clears after sending');

  // A's thread has to have caught up with B's reply before the menu is opened,
  // or `openMsgMenu` races the re-render that the reply triggers.
  await seen(A, 'text=this is a reply');
  await openMsgMenu(A, 'typing a reply');
  const editVisible = await A.locator('button:has-text("Edit")').isVisible().catch(() => false);
  check(editVisible, 'Edit is offered on your own text message');
  if (editVisible) {
    await A.locator('button:has-text("Edit")').click();
    check(await seen(A, 'text=Editing message'),
      'the edit bar appears with the original text loaded');
    await A.fill('textarea', 'edited message text');
    await A.keyboard.press('Enter');
    check(await seen(A, 'text=edited message text'), 'the edit saves');
    // A button, not a span, since 0020 — "edited" on its own asks a question it
    // will not answer, so it opens the prior versions.
    check(await seen(A, 'button:has-text("edited")'), 'and shows an "edited" marker');

    await A.locator('button:has-text("edited")').first().click();
    if (await migrationApplied('0020_edit_history.sql')) {
      // Scoped to the edited bubble, not the page. The original wording
      // ("typing a reply") also appears inside the reply that quotes it, so a
      // bare text match would pass without the history panel existing at all.
      const editedBubble = A.locator('div.group').filter({ hasText: 'edited message text' }).first();
      // Wait for the fetch, do not read straight after the click. The panel
      // renders a loading line first, and reading through it is how this
      // assertion failed against a database that had the history all along.
      await editedBubble.locator('text=typing a reply').first()
        .waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
      const bubbleText = await editedBubble.innerText().catch(() => '');
      check(bubbleText.includes('typing a reply'),
        'and clicking it shows what the message used to say',
        bubbleText.split('\n').join(' | ').slice(0, 100));
    } else {
      // Pre-0020 the edit happened in place and kept nothing, so there is
      // genuinely no history — the panel says so rather than showing an empty
      // box, and that is the correct behaviour to assert here.
      check(await seen(A, 'text=No earlier version was recorded'),
        'and clicking it says no earlier version was kept (0020 not applied)');
    }
  } else {
    await closeMenu(A);
  }

  await openMsgMenu(A, 'edited message text');
  const delVisible = await A.locator('button:has-text("Delete for everyone")').isVisible().catch(() => false);
  check(delVisible, 'Delete for everyone is offered');
  if (delVisible) {
    await A.locator('button:has-text("Delete for everyone")').click();
    check(await seen(A, 'text=This message was deleted'), 'the message becomes a tombstone');
    check(await gone(A, 'text=edited message text'),
      'and the original text is gone from the page');
  } else {
    await closeMenu(A);
  }

  console.log('\n--- 6. MUTE AND NOTIFICATION SETTINGS ---');
  const bell = A.locator('button[aria-label*="ute this conversation"], button[aria-label*="Muted"]').first();
  await bell.click();
  check(await seen(A, 'text=For 8 hours'), 'the mute menu opens with duration options');
  await A.locator('button:has-text("For 8 hours")').click();
  // The menu closes on selection; reopening before that lands would read the
  // old state and report a false failure.
  await gone(A, 'text=For 8 hours');
  await bell.click();
  check(await seen(A, 'text=/Muted until/i'), 'muting sticks and shows the expiry');
  await A.locator('button:has-text("Unmute")').click();
  await gone(A, 'text=/Muted until/i');

  await A.goto(`${APP}/settings`, { waitUntil: 'domcontentloaded' });
  check(await seen(A, 'text=Message notifications'),
    'the Notifications panel renders in Settings');

  // No worker before permission is granted — deliberate, there is nothing for
  // it to do yet. Asserting the opposite would enshrine a bug.
  check(!(await A.evaluate(() =>
    navigator.serviceWorker.getRegistration().then((r) => Boolean(r)).catch(() => false)
  )), 'no service worker before notifications are enabled (by design)');

  // Registration itself cannot be exercised here: chrome-headless-shell reports
  // Notification.permission as "denied" even after grantPermissions(), so the
  // app correctly declines to register. What CAN be checked is that the worker
  // script is served and carries the handlers it is supposed to.
  const swOk = await A.evaluate(async () => {
    const res = await fetch('/sw.js');
    if (!res.ok) return `HTTP ${res.status}`;
    const src = await res.text();
    return src.includes("addEventListener('push'") &&
      src.includes("addEventListener('notificationclick'")
      ? true
      : 'handlers missing';
  });
  check(swOk === true, 'sw.js is served and has push + notificationclick handlers',
    swOk === true ? '' : String(swOk));
  console.log('  SKIP  service worker registration — headless reports permission "denied"');
  console.log('        push delivery needs real Chrome: npm run push:test -- <username>');

  console.log('\n--- 7. CONVERSATION LIST ---');
  await A.goto(`${APP}/home`, { waitUntil: 'domcontentloaded' });
  check(await seen(A, `text=${userB}`), 'the conversation list shows the other person');
  check(await seen(A, 'text=this is a reply'),
    'and the last message preview is the most recent one');

  // A is sitting on /home, not in the conversation, so a new message from B is
  // genuinely unread. This is the loop the badge exists for, end to end:
  // insert -> realtime -> unread_counts RPC -> badge, with no reload.
  await B.fill('textarea', 'unread ping');
  await B.keyboard.press('Enter');
  check(await seen(A, '[aria-label="1 unread"]'),
    'an unread badge appears in the list without reloading');

  // Opening the conversation marks it read, which must clear the badge —
  // otherwise the count only ever climbs.
  //
  // Wait for the mark_message_read call itself, not for the message to appear.
  // ChatView renders the thread BEFORE it awaits the read receipts, so the text
  // is on screen while the RPCs are still in flight — and navigating away right
  // then cancels them. That is a real (if narrow) product race as well as a
  // test one: open a thread and leave instantly and it can stay unread. The
  // waiter is armed before the click so a fast response cannot be missed.
  const marked = A.waitForResponse(
    (r) => r.url().includes('mark_message_read'), { timeout: 15000 }
  ).catch(() => null);
  await A.locator(`text=${userB}`).first().click();
  await A.waitForURL(/\/chat\//, { timeout: 15000 });
  check(await seen(A, 'text=unread ping'), 'the new message is in the thread');
  check(await marked !== null, 'and opening it marks the message read');

  await A.goto(`${APP}/home`, { waitUntil: 'domcontentloaded' });
  await seen(A, `text=${userB}`);
  check(await gone(A, '[aria-label="1 unread"]'),
    'and it clears once the conversation is opened');

  // The desktop half of the single-mount check the phone pass makes. /home is
  // where the duplicate used to be, so it is the width that has to hold.
  const deskLists = await A.locator('text=Search contacts').count();
  check(deskLists === 1, 'the conversation list is mounted once on desktop /home',
    `got ${deskLists}`);
  const deskNavs = await A.locator('nav').count();
  check(deskNavs === 1, 'and so is the nav', `got ${deskNavs}`);

  // The list survives a tab change rather than being torn down and refetched.
  // It is hidden off /home on a phone, not unmounted, and on desktop it is
  // always on screen — either way one mount, and the sidebar still shows the
  // conversation after navigating away from /home and back.
  await A.goto(`${APP}/contacts`, { waitUntil: 'domcontentloaded' });
  check(await seen(A, `text=${userB}`),
    'and it is still there on /contacts, where the sidebar persists');

  console.log('\n--- 7b. A THREAD LONGER THAN THE LOAD LIMIT ---');
  // ChatView loads 200 messages. It used to take them ASCENDING, which is the
  // OLDEST 200 — so past that length a conversation showed the first 200
  // messages ever sent and nothing since, and new arrivals never appeared.
  // Nothing caught it because no test conversation had ever been long enough.
  // Its own conversation, so the 205 rows cannot disturb the unread counts and
  // last-message previews asserted above.
  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    const [{ data: aAcc }, { data: bAcc }] = await Promise.all([
      svc.from('accounts').select('id').eq('username', userA).single(),
      svc.from('accounts').select('id').eq('username', userB).single(),
    ]);
    const { data: longConv } = await svc.from('conversations')
      .insert({ type: 'direct', participant_ids: [aAcc.id, bAcc.id] })
      .select().single();

    const base = Date.now() - 300 * 60 * 1000;
    const rows = Array.from({ length: 205 }, (_, n) => ({
      conversation_id: longConv.id,
      sender_id: n % 2 ? aAcc.id : bAcc.id,
      // First and last are named so each can be asserted on by itself.
      content: n === 0 ? 'OLDEST-OF-205' : n === 204 ? 'NEWEST-OF-205' : `bulk ${n}`,
      message_type: 'text',
      read_by: [aAcc.id],
      created_date: new Date(base + n * 60 * 1000).toISOString(),
    }));
    for (let n = 0; n < rows.length; n += 50) {
      await svc.from('messages').insert(rows.slice(n, n + 50));
    }

    await A.goto(`${APP}/chat/${longConv.id}`, { waitUntil: 'domcontentloaded' });
    check(await seen(A, 'text=NEWEST-OF-205', 20000),
      'a 205-message thread shows the NEWEST message');
    check(await A.locator('text=OLDEST-OF-205').count() === 0,
      'and not the oldest, which falls outside the 200 it loads');

    await svc.from('conversations').delete().eq('id', longConv.id);
  } else {
    console.log('  SKIP  long-thread ordering — no service role key');
  }

  console.log('\n--- 9. PHONE WIDTH (390x844) ---');
  // FOLLOWUPS #9 carried "nothing has been checked at phone width" for days
  // because the Chrome extension could not resize below desktop. This app is
  // mobile-first, so that was the least-verified thing in it.
  //
  // THE PHONE CAN NOW SIGN IN AS THE DESKTOP ACCOUNT. This comment used to say
  // the opposite, and it was the sharpest evidence for FOLLOWUPS #6: the device
  // fingerprint includes screen size, so an account registered at 1280px was
  // refused at 390px and this pass had to register an account of its own. That
  // is a messenger you cannot use on your phone and your laptop. Binding was
  // dropped on 2026-08-16, and this is the assertion that proves it — a second
  // context, phone-sized, signing in as the account userA created at desktop
  // width. It gets its own context so nothing below is disturbed.
  const ctxCross = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3,
  });
  const X = await ctxCross.newPage();
  await X.goto(`${APP}/login`, { waitUntil: 'domcontentloaded' });
  const xInputs = X.locator('input');
  await xInputs.nth(0).fill(userA);
  await xInputs.nth(1).fill(PW);
  const xLogin = X.waitForResponse(
    (r) => r.url().includes('/api/auth/login'), { timeout: 25000 }
  ).catch(() => null);
  await X.click('button[type="submit"]');
  const xRes = await xLogin;
  check(xRes?.status() === 200,
    'a desktop-registered account signs in at phone width (binding is gone)',
    `status=${xRes?.status()}`);
  check(await X.waitForURL(/\/home/, { timeout: 20000 }).then(() => true).catch(() => false),
    'and lands on /home rather than being refused');
  await ctxCross.close();

  // userM still registers its own account below — not because it has to now,
  // but because the layout assertions want a conversation of their own that the
  // desktop assertions above are not also reading.
  const ctxM = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  const M = await ctxM.newPage();
  watchConsole(M, 'M');

  await register(M, userM);
  createdUsers.push(userM);
  check(M.url().includes('/home'), 'a phone-width context can register and sign in');

  // The second party and the thread are built server-side. Driving the whole
  // contact flow again would test nothing new — what is under test here is
  // rendering, not the contact handshake.
  const regN = await fetch(`${APP}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: userN, password: PW, display_name: 'Mobile Peer',
      recovery_password: RECOVERY, device_fingerprint: 'mobile-peer-fingerprint',
    }),
  });
  const nJson = await regN.json().catch(() => null);
  createdUsers.push(userN);

  const admin0 = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: mAcc } = await admin0.from('accounts').select('id').eq('username', userM).single();
  const { data: mConv } = await admin0.from('conversations')
    .insert({ type: 'direct', participant_ids: [mAcc.id, nJson.account.id] })
    .select().single();
  await admin0.from('messages').insert([
    { conversation_id: mConv.id, sender_id: nJson.account.id, content: 'short one', read_by: [] },
    { conversation_id: mConv.id, sender_id: mAcc.id, content: 'my own message', read_by: [mAcc.id] },
    // A long unbroken token is the classic way a chat layout blows its width.
    { conversation_id: mConv.id, sender_id: nJson.account.id, read_by: [],
      content: 'supercalifragilistic' + 'x'.repeat(60) + '@example.com' },
  ]);

  /** The single most useful mobile assertion: does the page scroll sideways? */
  const noOverflow = async (page, where) => {
    const o = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    }));
    check(o.scrollW <= o.innerW + 1, `no horizontal overflow on ${where}`,
      `scrollWidth=${o.scrollW} viewport=${o.innerW}`);
  };

  await M.goto(`${APP}/home`, { waitUntil: 'domcontentloaded' });
  // Measuring width before the list has rendered would measure an empty page,
  // which cannot overflow and would pass regardless.
  await seen(M, 'nav:visible');
  await noOverflow(M, '/home');
  const visibleNavs = await M.locator('nav:visible').count();
  check(visibleNavs === 1, 'exactly one bottom nav is visible on a phone', `got ${visibleNavs}`);
  const navCount = await M.locator('nav:visible a').count();
  check(navCount === 4, 'and it shows four items (Earn is gone)', `got ${navCount}`);

  // The raw node count, which is the one that catches the actual bug. This
  // assertion used to be impossible: AppLayout rendered BottomNav twice and
  // ConversationList twice on /home, letting CSS pick, so the DOM held two of
  // each at every width and only `:visible` meant anything. React mounts what
  // CSS hides, so the second copy was running its effects — a whole extra
  // realtime channel and set of queries. Both render once now, and counting
  // nodes is how that stays true.
  const domNavs = await M.locator('nav').count();
  check(domNavs === 1, 'and only one is in the DOM at all — not two with CSS picking',
    `got ${domNavs}`);
  // The list's own header, which is unique to it, so this counts mounts rather
  // than conversation rows.
  const domLists = await M.locator('text=Search contacts').count();
  check(domLists === 1, 'and the conversation list is mounted exactly once', `got ${domLists}`);

  await M.goto(`${APP}/chat/${mConv.id}`, { waitUntil: 'domcontentloaded' });
  // The long-word message specifically — that is the one under test, and it is
  // the last of the three to render.
  await seen(M, 'text=/supercalifragilistic/');
  await noOverflow(M, '/chat with a long unbroken word');
  check(await seen(M, 'textarea'), 'the composer is visible on a phone');

  // The action menu is w-44 (176px) inside a 390px viewport, anchored to the
  // bubble. On an own message (right-aligned) it anchors right; on a received
  // one it anchors left. Either can run off the edge.
  await openMsgMenu(M, 'my own message');
  const ownMenu = await M.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(
      (d) => d.className.includes('absolute z-50') && d.offsetParent !== null
    );
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), vw: window.innerWidth };
  });
  check(ownMenu && ownMenu.left >= 0 && ownMenu.right <= ownMenu.vw,
    'the action menu fits on screen for your own message', JSON.stringify(ownMenu));
  await closeMenu(M);

  await openMsgMenu(M, 'short one');
  const theirMenu = await M.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(
      (d) => d.className.includes('absolute z-50') && d.offsetParent !== null
    );
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), right: Math.round(r.right), vw: window.innerWidth };
  });
  check(theirMenu && theirMenu.left >= 0 && theirMenu.right <= theirMenu.vw,
    'the action menu fits on screen for a received message', JSON.stringify(theirMenu));

  // Reply bar at phone width.
  await M.locator('button:has-text("Reply")').click();
  check(await seen(M, 'text=/Replying to/i'), 'the reply bar renders on a phone');
  await noOverflow(M, '/chat with the reply bar open');

  await M.goto(`${APP}/settings`, { waitUntil: 'domcontentloaded' });
  await seen(M, 'text=Message notifications');
  await noOverflow(M, '/settings');
  await M.goto(`${APP}/contacts`, { waitUntil: 'domcontentloaded' });
  await seen(M, 'input[placeholder="Search by username..."]');
  await noOverflow(M, '/contacts');

  console.log('\n--- 8. CONSOLE ---');
  // Push failures are expected here — headless Chromium has no push service —
  // and so are favicon/manifest 404s. Everything else is ours and is a bug.
  const real = consoleErrors.filter(
    (e) => !/favicon|manifest|push|notification|Failed to load resource/i.test(e)
  );
  check(real.length === 0, 'no unexpected console errors', real.slice(0, 3).join(' | '));
  if (real.length) real.slice(0, 8).forEach((e) => console.log('        ' + e));

} catch (err) {
  console.log(`\n  FATAL  ${err.message}`);
  fail++;
} finally {
  console.log(`\n=========== ${pass} passed, ${fail} failed ===========\n`);
  await browser.close();

  // Delete the two accounts this run created. Without it every run leaves real
  // users in the project, and they accumulate silently. Deleting the auth user
  // cascades through accounts, messages, conversations and the rest.
  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: rows } = await admin
      .from('accounts').select('id').in('username', createdUsers);
    const ids = (rows || []).map((r) => r.id);

    // Conversations first. participant_ids is an array, not a foreign key, so
    // it does NOT cascade when the accounts go — deleting the users first would
    // strand the conversation rows permanently.
    if (ids.length) {
      const { data: convs } = await admin
        .from('conversations').select('id, participant_ids');
      const mine = (convs || []).filter((c) =>
        (c.participant_ids || []).some((p) => ids.includes(p))
      );
      for (const c of mine) await admin.from('conversations').delete().eq('id', c.id);
    }

    for (const id of ids) await admin.auth.admin.deleteUser(id).catch(() => {});
    console.log(`test users deleted (${ids.length})`);
  } else {
    console.log(`NOTE: no service-role key — ${createdUsers.join(', ')} were left behind.`);
  }

  process.exit(fail ? 1 : 0);
}
