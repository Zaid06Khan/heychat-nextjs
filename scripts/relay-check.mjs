/**
 * Does the relay actually accept our credentials and allocate?
 *
 * Everything else asserts the credential's SHAPE. This asks the relay itself:
 * a real RTCPeerConnection, gathering real candidates against the ICE servers
 * `/api/calls/ice` hands out. A candidate of type `relay` means Cloudflare
 * authenticated us and reserved an address to forward through — which is the
 * one thing no amount of format-checking can prove.
 *
 * `host` and `srflx` candidates prove nothing; you get those with no relay at
 * all. `relay` is the whole test.
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const res = await fetch(
  `https://rtc.live.cloudflare.com/v1/turn/keys/${env.CLOUDFLARE_TURN_KEY_ID}/credentials/generate-ice-servers`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_TURN_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ttl: 3600 }),
  }
);
if (!res.ok) {
  console.error('could not mint credentials: HTTP', res.status);
  process.exit(1);
}
const { iceServers } = await res.json();

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('about:blank');

const result = await page.evaluate(async (servers) => {
  // iceTransportPolicy: 'relay' REFUSES to use anything but the relay, so a
  // candidate can only appear if the allocation genuinely succeeded. Without
  // it a host candidate would arrive first and prove nothing.
  const pc = new RTCPeerConnection({ iceServers: servers, iceTransportPolicy: 'relay' });
  const candidates = [];
  const errors = [];

  pc.onicecandidate = (e) => { if (e.candidate) candidates.push(e.candidate.candidate); };
  pc.onicecandidateerror = (e) =>
    errors.push({ code: e.errorCode, text: e.errorText, url: e.url });

  pc.createDataChannel('probe');
  await pc.setLocalDescription(await pc.createOffer());

  await new Promise((resolve) => {
    const done = () => resolve();
    pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') done(); };
    setTimeout(done, 15000);
  });

  const types = candidates.map((c) => {
    const m = c.match(/ typ (\w+)/);
    return m ? m[1] : '?';
  });
  pc.close();
  return { count: candidates.length, types, errors, sample: candidates[0] || null };
}, iceServers);

console.log('candidates gathered :', result.count);
console.log('candidate types     :', JSON.stringify(result.types));
console.log('ICE errors          :', result.errors.length ? JSON.stringify(result.errors) : '(none)');
if (result.sample) {
  // Redacted: a candidate line carries the allocated relay address.
  console.log('sample (redacted)   :', result.sample.replace(/\d+\.\d+\.\d+\.\d+/g, 'x.x.x.x'));
}

const relayed = result.types.includes('relay');
console.log(relayed
  ? '\nPASS  the relay authenticated us and allocated an address'
  : '\nFAIL  no relay candidate — credentials rejected, or the relay is unreachable');

await browser.close();
process.exit(relayed ? 0 : 1);
