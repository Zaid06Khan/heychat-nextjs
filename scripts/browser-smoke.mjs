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
 * TWO BROWSER CONTEXTS, not two browsers: the device fingerprint is derived
 * from user-agent, screen size, canvas and timezone, so two contexts in one
 * Chromium produce the same fingerprint. Each account stores its own copy of
 * it, so both match and both can sign in — which is what makes a two-user test
 * possible in a single browser, and why logging an existing account in from a
 * genuinely different browser would fail instead.
 *
 * Like the e2e suite, this talks to the REAL Supabase project in .env.local and
 * creates real users. It deletes them again at the end.
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
  await bubble.hover();
  await page.waitForTimeout(300);
  await bubble.locator('button[aria-label="Message actions"]').click({ force: true });
  await page.waitForTimeout(600);
};

/** The menu's click-away backdrop covers the viewport; any click closes it. */
const closeMenu = async (page) => {
  await page.mouse.click(5, 400);
  await page.waitForTimeout(400);
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
  await page.waitForTimeout(1500); // let the username-availability check settle
  await page.click('button[type="submit"]');
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
  await A.waitForTimeout(2500);
  check(await A.locator(`text=@${userB}`).first().isVisible().catch(() => false),
    'A can find B by username search');
  await A.locator('button:has-text("Add")').first().click();
  await A.waitForTimeout(1500);
  check(await A.locator('text=Sent').first().isVisible().catch(() => false),
    'the request is sent');

  await B.goto(`${APP}/contacts`, { waitUntil: 'domcontentloaded' });
  await B.locator('button:has-text("Requests")').click();
  await B.waitForTimeout(1500);
  const acceptBtn = B.locator('button[aria-label^="Accept contact request"]').first();
  const hasRequest = await acceptBtn.isVisible().catch(() => false);
  check(hasRequest, 'B sees the incoming contact request');
  if (!hasRequest) throw new Error('no contact request — cannot continue to messaging');
  // Accepting is what creates the conversation (Contacts.jsx acceptRequest).
  await acceptBtn.click();
  await B.waitForTimeout(2500);
  check(true, 'B accepts, which creates the conversation');

  console.log('\n--- 3. MESSAGING ---');
  await B.goto(`${APP}/home`, { waitUntil: 'domcontentloaded' });
  await B.waitForTimeout(1500);
  await B.locator(`text=${userA}`).first().click();
  await B.waitForURL(/\/chat\//, { timeout: 15000 });
  const convUrl = B.url();
  check(true, 'B opens the conversation', convUrl);

  await A.goto(convUrl, { waitUntil: 'domcontentloaded' });
  await A.waitForTimeout(2000);

  await B.fill('textarea', 'hello from B');
  await B.keyboard.press('Enter');
  await B.waitForTimeout(2500);
  check(await B.locator('text=hello from B').first().isVisible(), 'B sends a message and sees it');

  await A.waitForSelector('text=hello from B', { timeout: 15000 }).catch(() => {});
  check(await A.locator('text=hello from B').first().isVisible().catch(() => false),
    'A receives it over realtime without reloading');

  console.log('\n--- 4. TYPING INDICATOR ---');
  // The reason this file exists in the first place: typing needs two live
  // browsers, so the e2e suite cannot reach it. Private channels fail CLOSED,
  // so if the 0013 policies are missing this silently shows nothing.
  await A.click('textarea');
  await A.type('textarea', 'typing a reply', { delay: 60 });
  const sawTyping = await B.waitForSelector('text=/is typing/i', { timeout: 12000 })
    .then(() => true)
    .catch(() => false);
  check(sawTyping, 'B sees "is typing" while A types');

  const typingWarn = consoleErrors.filter((e) => e.includes('[typing]'));
  check(typingWarn.length === 0, 'no typing-channel refusal in the console', typingWarn[0] || '');

  await A.keyboard.press('Enter');
  await A.waitForTimeout(2500);
  check(!(await B.locator('text=/is typing/i').isVisible().catch(() => false)),
    'the indicator clears once the message is sent');

  console.log('\n--- 5. REPLIES, REACTIONS, EDIT, DELETE ---');
  await openMsgMenu(A, 'typing a reply');
  check(await A.locator('text=Delete for everyone').isVisible().catch(() => false),
    'the message action menu opens on your own message');

  await A.locator('button:has-text("React")').click();
  await A.waitForTimeout(500);
  await A.locator('button:has-text("👍")').first().click();
  await A.waitForTimeout(2000);
  check(await A.locator('text=👍').first().isVisible().catch(() => false),
    'a reaction renders on the bubble');

  // Reactions are deliberately NOT in the realtime feed yet (FOLLOWUPS #11), so
  // this asserts what the app actually promises: B sees it on next load.
  await B.reload({ waitUntil: 'domcontentloaded' });
  await B.waitForTimeout(3500);
  check(await B.locator('text=👍').first().isVisible().catch(() => false),
    'and B sees it after reloading (reactions are not realtime yet)');

  await openMsgMenu(B, 'typing a reply');
  await B.locator('button:has-text("Reply")').click();
  await B.waitForTimeout(600);
  check(await B.locator('text=/Replying to/i').isVisible().catch(() => false),
    'the reply composer bar appears');
  await B.fill('textarea', 'this is a reply');
  await B.keyboard.press('Enter');
  await B.waitForTimeout(2500);
  check(await B.locator('text=this is a reply').first().isVisible().catch(() => false),
    'the reply sends');
  check((await B.locator('text=/Replying to/i').isVisible().catch(() => false)) === false,
    'and the reply bar clears after sending');

  await A.waitForTimeout(2500);
  await openMsgMenu(A, 'typing a reply');
  const editVisible = await A.locator('button:has-text("Edit")').isVisible().catch(() => false);
  check(editVisible, 'Edit is offered on your own text message');
  if (editVisible) {
    await A.locator('button:has-text("Edit")').click();
    await A.waitForTimeout(600);
    check(await A.locator('text=Editing message').isVisible().catch(() => false),
      'the edit bar appears with the original text loaded');
    await A.fill('textarea', 'edited message text');
    await A.keyboard.press('Enter');
    await A.waitForTimeout(2500);
    check(await A.locator('text=edited message text').first().isVisible().catch(() => false),
      'the edit saves');
    check(await A.locator('span:has-text("edited")').first().isVisible().catch(() => false),
      'and shows an "edited" marker');
  } else {
    await closeMenu(A);
  }

  await openMsgMenu(A, 'edited message text');
  const delVisible = await A.locator('button:has-text("Delete for everyone")').isVisible().catch(() => false);
  check(delVisible, 'Delete for everyone is offered');
  if (delVisible) {
    await A.locator('button:has-text("Delete for everyone")').click();
    await A.waitForTimeout(2500);
    check(await A.locator('text=This message was deleted').first().isVisible().catch(() => false),
      'the message becomes a tombstone');
    check((await A.locator('text=edited message text').isVisible().catch(() => false)) === false,
      'and the original text is gone from the page');
  } else {
    await closeMenu(A);
  }

  console.log('\n--- 6. MUTE AND NOTIFICATION SETTINGS ---');
  const bell = A.locator('button[aria-label*="ute this conversation"], button[aria-label*="Muted"]').first();
  await bell.click();
  await A.waitForTimeout(600);
  check(await A.locator('text=For 8 hours').isVisible().catch(() => false),
    'the mute menu opens with duration options');
  await A.locator('button:has-text("For 8 hours")').click();
  await A.waitForTimeout(2000);
  await bell.click();
  await A.waitForTimeout(600);
  check(await A.locator('text=/Muted until/i').isVisible().catch(() => false),
    'muting sticks and shows the expiry');
  await A.locator('button:has-text("Unmute")').click();
  await A.waitForTimeout(1500);

  await A.goto(`${APP}/settings`, { waitUntil: 'domcontentloaded' });
  await A.waitForTimeout(2500);
  check(await A.locator('text=Message notifications').isVisible().catch(() => false),
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
  await A.waitForTimeout(3000);
  check(await A.locator(`text=${userB}`).first().isVisible().catch(() => false),
    'the conversation list shows the other person');
  check(await A.locator('text=this is a reply').first().isVisible().catch(() => false),
    'and the last message preview is the most recent one');

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
      .from('accounts').select('id').in('username', [userA, userB]);
    for (const row of rows || []) {
      await admin.auth.admin.deleteUser(row.id).catch(() => {});
    }
    console.log(`test users deleted (${(rows || []).length})`);
  } else {
    console.log(`NOTE: no service-role key — ${userA} and ${userB} were left behind.`);
  }

  process.exit(fail ? 1 : 0);
}
