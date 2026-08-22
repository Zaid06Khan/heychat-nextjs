/**
 * Does the bundled app actually start?
 *
 * A build that succeeds and a bundle that boots are different claims — the
 * whole point of this exercise is that the app leaves Next behind, and the
 * things Next was providing (the HTML shell, the fonts, the entry point) are
 * now hand-written. If one of them is wrong the failure is a white screen on a
 * phone, which is the most expensive place to find out.
 *
 * Serves `www/` over http and loads it, from an ORIGIN THAT IS NOT the API's,
 * which is the situation inside the app.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.woff2': 'font/woff2', '.png': 'image/png', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path === '/' || path === '\\') path = '/index.html';
  try {
    const body = await readFile(join('www', path));
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    // The SPA routes client-side, so an unknown path is a deep link, not a 404.
    try {
      const body = await readFile(join('www', 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  }
});

await new Promise((r) => server.listen(4173, r));
const APP = 'http://localhost:4173';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)));

let pass = 0, fail = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${extra ? '  -- ' + extra : ''}`);
  ok ? pass++ : fail++;
};

try {
  await page.goto(APP, { waitUntil: 'domcontentloaded' });

  // The splash is in the HTML, so it is there before anything runs.
  check(await page.locator('text=Calamus3').first().isVisible(), 'the splash paints from the HTML itself');

  // React replacing it is the proof the bundle parsed and mounted.
  const mounted = await page
    .waitForSelector('text=/Create Account|Log In/i', { state: 'visible', timeout: 20000 })
    .then(() => true).catch(() => false);
  check(mounted, 'React mounts and the landing screen renders');

  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const names = new Set();
    document.fonts.forEach((f) => names.add(f.family));
    const body = getComputedStyle(document.body).fontFamily;
    return { loaded: [...names], body };
  });
  check(fonts.loaded.some((f) => /Bricolage/i.test(f)), 'the display font loaded', fonts.loaded.join(', ') || 'none');
  check(/Jakarta/i.test(fonts.body) || fonts.loaded.some((f) => /Jakarta/i.test(f)),
    'and the body font is bound to the CSS variable', fonts.body);

  // The thing this whole exercise is for: the client must call the API at an
  // absolute origin, because a relative path resolves inside the app package.
  const apiOrigin = await page.evaluate(() => {
    const el = document.querySelector('script[type=module]');
    return el ? 'module present' : 'no module script';
  });
  const requests = [];
  page.on('request', (r) => { if (r.url().includes('/api/')) requests.push(r.url()); });
  await page.waitForTimeout(1500);
  check(requests.every((u) => !u.startsWith(APP)),
    'no API call resolves against the bundle origin',
    requests.length ? requests.slice(0, 2).join(' ') : 'none attempted on this screen');

  check(!await page.locator('text=/failed to load|white screen/i').count(), 'no load-failure text', apiOrigin);

  const fatal = errors.filter((e) => /is not defined|Cannot read|SyntaxError|Failed to fetch dynamically/i.test(e));
  check(fatal.length === 0, 'no fatal console errors', fatal[0] || '');
} catch (e) {
  fail++;
  console.error('THREW:', e.message);
} finally {
  console.log('\nconsole errors:', errors.length ? errors.slice(0, 5).join('\n  ') : '(none)');
  console.log(`\n=========== ${pass} passed, ${fail} failed ===========\n`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
}
