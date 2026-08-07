/**
 * Throwaway route. Renders the same conversation in three candidate visual
 * directions so one can be picked against real type at real size, rather than
 * off a list of hex values.
 *
 * Delete this directory once the direction is chosen.
 *
 * It is an App Router route on purpose, so it sits outside the React Router SPA
 * and touches no existing file. It also does no Supabase and no auth.
 */

import {
  Newsreader,
  Instrument_Sans,
  Courier_Prime,
  Geist,
  Geist_Mono,
  Bricolage_Grotesque,
  Plus_Jakarta_Sans,
} from 'next/font/google';

export const metadata = { title: 'HeyChat — three directions' };

/* Airmail */
const newsreader = Newsreader({ subsets: ['latin'], variable: '--f-news' });
const instrumentSans = Instrument_Sans({ subsets: ['latin'], variable: '--f-isans' });
const courierPrime = Courier_Prime({ subsets: ['latin'], weight: ['400', '700'], variable: '--f-courier' });

/* Instrument */
const geist = Geist({ subsets: ['latin'], variable: '--f-geist' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--f-geistmono' });

/* Bodega. General Sans is Fontshare, not Google — Plus Jakarta Sans stands in
   for it here. Same geometric neo-grotesque register; slightly less quirky. */
const bricolage = Bricolage_Grotesque({ subsets: ['latin'], variable: '--f-bricolage' });
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--f-jakarta' });

const FONTS = [
  newsreader, instrumentSans, courierPrime,
  geist, geistMono,
  bricolage, jakarta,
].map((f) => f.variable).join(' ');

/* One conversation, rendered three times. Varied lengths on purpose — the long
   message is what tells you whether a serif body actually works. */
const THREAD = [
  { from: 'them', text: 'did you get the thing working', time: '10:41' },
  { from: 'me', text: 'yeah finally. turned out the whole problem was that the keys were never being sent at all, not that they were wrong', time: '10:42' },
  { from: 'them', text: 'ha. classic', time: '10:42' },
  { from: 'them', text: 'so are we still on for saturday or has that quietly died', time: '10:43' },
  { from: 'me', text: "still on. i'll book the table for 7", time: '10:44' },
  { from: 'them', text: "perfect. don't be late this time", time: '10:45' },
  { from: 'me', text: 'i was late once', time: '10:45' },
];

const NAV = ['Chats', 'Contacts', 'Earn', 'Profile', 'Settings'];

/* Nav glyphs, drawn rather than imported so each direction can set its own
   stroke weight — line weight is part of how these three differ. */
function Glyph({ name, w = 1.75 }) {
  const p = {
    Chats: 'M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-2.8-.4L3 21l1.9-5.7A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z',
    Contacts: 'M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9',
    Earn: 'M12 2v20M17 6.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.8 5 3.5 5 1.6 5 3.5-2.2 3-5 3-5-1.1-5-3',
    Profile: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    Settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9h-.2a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5v-.2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.4l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z',
  }[name];
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={p} />
    </svg>
  );
}

/* ---------------------------------------------------------------- Airmail */
function Airmail() {
  return (
    <div className="mock am">
      <header className="am-hd">
        <div className="am-stamp" aria-hidden="true">N</div>
        <div className="am-who">
          <span className="am-name">Nadia</span>
          <span className="am-meta">delivered 10:45 · encrypted in transit</span>
        </div>
        <div className="am-perf" aria-hidden="true" />
      </header>

      <div className="am-thread">
        <div className="am-day"><span>Tuesday</span></div>
        {THREAD.map((m, i) => (
          <div key={i} className={`am-row ${m.from === 'me' ? 'is-mine' : ''}`} style={{ '--i': i }}>
            <div className="am-bub">
              <p>{m.text}</p>
              <span className="am-time">{m.time}{m.from === 'me' ? ' ✓' : ''}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="am-comp">
        <button className="am-clip" aria-label="Attach a file">+</button>
        <div className="am-field">Message Nadia</div>
        <button className="am-send" aria-label="Send">→</button>
      </div>

      <nav className="am-nav">
        {NAV.map((n) => (
          <a key={n} className={n === 'Chats' ? 'on' : ''}>
            <Glyph name={n} w={1.5} /><span>{n}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}

/* ------------------------------------------------------------- Instrument */
function Instrument() {
  return (
    <div className="mock in">
      <header className="in-hd">
        <div className="in-av" aria-hidden="true">N</div>
        <div className="in-who">
          <span className="in-name">Nadia</span>
          <span className="in-read"><i className="in-dot" />ONLINE · TLS 1.3 · 4F2A·9C71</span>
        </div>
        <div className="in-sig" aria-hidden="true"><i /><i /><i /></div>
      </header>

      <div className="in-thread">
        <div className="in-day"><span>TUE 04 AUG</span></div>
        {THREAD.map((m, i) => (
          <div key={i} className={`in-row ${m.from === 'me' ? 'is-mine' : ''}`} style={{ '--i': i }}>
            <div className="in-bub">
              <p>{m.text}</p>
              <span className="in-time">{m.time}{m.from === 'me' ? ' ✓✓' : ''}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="in-comp">
        <button className="in-clip" aria-label="Attach a file">+</button>
        <div className="in-field">Message Nadia</div>
        <button className="in-send" aria-label="Send">↑</button>
      </div>

      <nav className="in-nav">
        {NAV.map((n) => (
          <a key={n} className={n === 'Chats' ? 'on' : ''}>
            <Glyph name={n} w={1.5} /><span>{n}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}

/* ----------------------------------------------------------------- Bodega */
function Bodega() {
  return (
    <div className="mock bo">
      <header className="bo-hd">
        <div className="bo-av" aria-hidden="true">N</div>
        <div className="bo-who">
          <span className="bo-name">Nadia</span>
          <span className="bo-meta">online now</span>
        </div>
        <div className="bo-streak">🔥 6</div>
      </header>

      <div className="bo-thread">
        <div className="bo-day"><span>TUESDAY</span></div>
        {THREAD.map((m, i) => (
          <div key={i} className={`bo-row ${m.from === 'me' ? 'is-mine' : ''}`} style={{ '--i': i }}>
            <div className="bo-bub">
              <p>{m.text}</p>
              <span className="bo-time">{m.time}{m.from === 'me' ? ' ✓✓' : ''}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="bo-comp">
        <button className="bo-clip" aria-label="Attach a file">+</button>
        <div className="bo-field">Message Nadia</div>
        <button className="bo-send" aria-label="Send">↑</button>
      </div>

      <nav className="bo-nav">
        {NAV.map((n) => (
          <a key={n} className={`${n === 'Chats' ? 'on' : ''} ${n === 'Earn' ? 'earn' : ''}`}>
            <Glyph name={n} w={2.25} /><span>{n}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}

/* ------------------------------------------------------------------ shell */
const CARDS = [
  {
    key: 'airmail',
    n: 'Airmail',
    line: 'For people who mean what they write.',
    note: 'Newsreader · Instrument Sans · Courier Prime',
    swatch: ['#F6F2E9', '#EAE3D4', '#1A1917', '#C8102E', '#1B3A6B', '#8C8880'],
    render: <Airmail />,
  },
  {
    key: 'instrument',
    n: 'Instrument',
    line: 'For people who care that nobody else is reading.',
    note: 'Geist · Geist Mono',
    swatch: ['#171B21', '#1F252D', '#2C343E', '#E4E7EA', '#E8A33D', '#7FA8C9'],
    render: <Instrument />,
  },
  {
    key: 'bodega',
    n: 'Bodega',
    line: 'Where talking to friends pays you.',
    note: 'Bricolage Grotesque · General Sans (Plus Jakarta standing in)',
    swatch: ['#FFFDF7', '#F0EDE4', '#12100E', '#2B4CFF', '#FFD23F', '#FF4D2E'],
    render: <Bodega />,
  },
];

export default function DesignPreview() {
  return (
    <div className={`wrap ${FONTS}`}>
      <style>{CSS}</style>

      <header className="top">
        <h1>Three directions, one conversation</h1>
        <p>
          The same seven messages in each, so the difference you are judging is the
          direction and not the content. Pick one and it gets built as a token
          system before any screen is touched.
        </p>
      </header>

      <div className="rail">
        {CARDS.map((c) => (
          <section key={c.key} className="card">
            <div className="frame">{c.render}</div>
            <div className="cap">
              <h2>{c.n}</h2>
              <p className="line">{c.line}</p>
              <div className="sw" aria-hidden="true">
                {c.swatch.map((s) => <i key={s} style={{ background: s }} title={s} />)}
              </div>
              <p className="note">{c.note}</p>
            </div>
          </section>
        ))}
      </div>

      <footer className="foot">
        Scroll sideways if all three do not fit. Delete{' '}
        <code>src/app/design-preview/</code> once you have picked.
      </footer>
    </div>
  );
}

const CSS = `
.wrap{--sh-bg:#12131A;--sh-fg:#E8E8EC;--sh-dim:#8A8A96;--sh-line:#26262F;
  min-height:100vh;background:var(--sh-bg);color:var(--sh-fg);
  font-family:var(--f-isans),system-ui,sans-serif;padding:48px 0 72px;}
.wrap *{box-sizing:border-box;}

.top{max-width:640px;margin:0 auto 44px;padding:0 24px;text-align:center;}
.top h1{font-size:26px;font-weight:600;letter-spacing:-.02em;margin:0 0 10px;}
.top p{font-size:14px;line-height:1.65;color:var(--sh-dim);margin:0;}

.rail{display:flex;gap:28px;justify-content:center;align-items:flex-start;
  overflow-x:auto;padding:4px 24px 24px;scroll-snap-type:x mandatory;}
.card{flex:0 0 auto;scroll-snap-align:center;}
.frame{width:390px;height:760px;border-radius:26px;overflow:hidden;
  border:1px solid var(--sh-line);box-shadow:0 20px 50px rgba(0,0,0,.45);}
.cap{width:390px;padding:18px 4px 0;}
.cap h2{font-size:17px;font-weight:600;margin:0 0 4px;letter-spacing:-.01em;}
.cap .line{font-size:13px;color:var(--sh-dim);margin:0 0 12px;line-height:1.5;}
.sw{display:flex;gap:5px;margin-bottom:10px;}
.sw i{width:26px;height:26px;border-radius:5px;border:1px solid rgba(255,255,255,.14);}
.cap .note{font-size:11.5px;color:var(--sh-dim);margin:0;letter-spacing:.01em;}

.foot{text-align:center;font-size:12.5px;color:var(--sh-dim);margin-top:18px;padding:0 24px;}
.foot code{font-family:var(--f-geistmono),monospace;font-size:12px;
  background:rgba(255,255,255,.07);padding:2px 6px;border-radius:4px;}

.mock{height:100%;display:flex;flex-direction:column;}
/* min-height:0 or the thread refuses to shrink below its content and runs
   under the composer. flex-end pins it to the newest message, as a real
   chat does on open. */
.mock .am-thread,.mock .in-thread,.mock .bo-thread{flex:1;min-height:0;
  overflow:hidden;justify-content:flex-end;}
.mock nav{display:flex;justify-content:space-around;align-items:center;}
.mock nav a{display:flex;flex-direction:column;align-items:center;gap:4px;cursor:default;}
.mock nav svg{width:19px;height:19px;}

/* ---- Airmail ---- */
.am{background:#F6F2E9;color:#1A1917;font-family:var(--f-isans),sans-serif;}
.am-hd{display:flex;align-items:center;gap:12px;padding:16px 18px 14px;
  background:#EAE3D4;border-bottom:1px solid rgba(26,25,23,.13);position:relative;}
.am-stamp{width:40px;height:40px;flex:0 0 auto;background:#F6F2E9;color:#1B3A6B;
  border:1px solid #1B3A6B;display:grid;place-items:center;
  font-family:var(--f-news),serif;font-size:19px;font-weight:500;
  box-shadow:0 0 0 2px #EAE3D4,0 0 0 3px rgba(27,58,107,.3);}
.am-who{display:flex;flex-direction:column;gap:2px;min-width:0;}
.am-name{font-family:var(--f-news),serif;font-size:19px;font-weight:500;letter-spacing:-.01em;}
.am-meta{font-family:var(--f-courier),monospace;font-size:10px;color:#8C8880;
  letter-spacing:.03em;text-transform:uppercase;}
.am-perf{position:absolute;left:0;right:0;bottom:-1px;height:2px;
  background:repeating-linear-gradient(90deg,#C8102E 0 8px,transparent 8px 16px,#1B3A6B 16px 24px,transparent 24px 32px);
  opacity:.5;}

.am-thread{padding:18px 18px 8px;display:flex;flex-direction:column;gap:14px;}
.am-day{text-align:center;margin-bottom:2px;}
.am-day span{font-family:var(--f-courier),monospace;font-size:10px;color:#8C8880;
  letter-spacing:.16em;text-transform:uppercase;
  border-top:1px solid rgba(26,25,23,.12);border-bottom:1px solid rgba(26,25,23,.12);padding:3px 0;}
.am-row{display:flex;}
.am-row.is-mine{justify-content:flex-end;}
.am-bub{position:relative;max-width:76%;background:#fff;padding:11px 14px 9px 18px;
  border:1px solid rgba(26,25,23,.14);}
.am-row.is-mine .am-bub{background:#EAE3D4;}
.am-bub::before{content:'';position:absolute;left:0;top:0;bottom:0;width:5px;background:#8C8880;opacity:.22;}
.am-row.is-mine .am-bub::before{opacity:1;background:repeating-linear-gradient(45deg,
  #C8102E 0 5px,#F6F2E9 5px 10px,#1B3A6B 10px 15px,#F6F2E9 15px 20px);}
.am-bub p{margin:0 0 5px;font-family:var(--f-news),serif;font-size:15.5px;
  line-height:1.55;letter-spacing:.004em;}
.am-time{font-family:var(--f-courier),monospace;font-size:9.5px;color:#8C8880;letter-spacing:.06em;}

.am-comp{display:flex;align-items:center;gap:10px;padding:12px 16px;
  background:#EAE3D4;border-top:1px solid rgba(26,25,23,.13);}
.am-clip{width:30px;height:30px;flex:0 0 auto;border:1px solid rgba(26,25,23,.25);
  background:none;color:#1A1917;font-size:17px;line-height:1;border-radius:50%;}
.am-field{flex:1;background:#F6F2E9;border:1px solid rgba(26,25,23,.16);
  padding:9px 13px;font-family:var(--f-news),serif;font-size:14.5px;color:#8C8880;font-style:italic;}
.am-send{width:34px;height:34px;flex:0 0 auto;border:none;background:#C8102E;color:#F6F2E9;
  font-size:15px;border-radius:50%;}

.am-nav{padding:9px 6px 13px;background:#EAE3D4;border-top:1px solid rgba(26,25,23,.13);}
.am-nav a{color:#8C8880;}
.am-nav a.on{color:#C8102E;}
.am-nav span{font-family:var(--f-courier),monospace;font-size:8.5px;
  letter-spacing:.07em;text-transform:uppercase;}

/* ---- Instrument ---- */
.in{background:#171B21;color:#E4E7EA;font-family:var(--f-geist),sans-serif;}
.in-hd{display:flex;align-items:center;gap:11px;padding:14px 16px;
  background:#1F252D;border-bottom:1px solid #2C343E;}
.in-av{width:34px;height:34px;flex:0 0 auto;border-radius:4px;background:#2C343E;
  color:#7FA8C9;display:grid;place-items:center;font-size:14px;font-weight:500;}
.in-who{display:flex;flex-direction:column;gap:3px;min-width:0;}
.in-name{font-size:15px;font-weight:550;letter-spacing:-.01em;}
.in-read{display:flex;align-items:center;gap:6px;font-family:var(--f-geistmono),monospace;
  font-size:9px;color:#7c8896;letter-spacing:.09em;}
.in-dot{width:5px;height:5px;background:#E8A33D;border-radius:50%;flex:0 0 auto;}
.in-sig{display:flex;align-items:flex-end;gap:2px;margin-left:auto;height:14px;}
.in-sig i{width:3px;background:#E8A33D;}
.in-sig i:nth-child(1){height:5px;opacity:.45;}
.in-sig i:nth-child(2){height:9px;opacity:.7;}
.in-sig i:nth-child(3){height:14px;}

.in-thread{padding:16px 16px 8px;display:flex;flex-direction:column;gap:9px;}
.in-day{text-align:center;margin-bottom:5px;}
.in-day span{font-family:var(--f-geistmono),monospace;font-size:9px;color:#5f6a77;letter-spacing:.16em;}
.in-row{display:flex;}
.in-row.is-mine{justify-content:flex-end;}
.in-bub{max-width:78%;background:#1F252D;border:1px solid #2C343E;border-left:2px solid #7FA8C9;
  border-radius:4px;padding:8px 11px 7px;}
.in-row.is-mine .in-bub{border-left:none;border-right:2px solid #E8A33D;background:#20272f;}
.in-bub p{margin:0 0 4px;font-size:13.5px;line-height:1.5;letter-spacing:-.002em;}
.in-time{font-family:var(--f-geistmono),monospace;font-size:9px;color:#5f6a77;letter-spacing:.05em;}

.in-comp{display:flex;align-items:center;gap:9px;padding:11px 14px;
  background:#1F252D;border-top:1px solid #2C343E;}
.in-clip{width:28px;height:28px;flex:0 0 auto;border:1px solid #2C343E;border-radius:4px;
  background:none;color:#7c8896;font-size:15px;line-height:1;}
.in-field{flex:1;background:#171B21;border:1px solid #2C343E;border-radius:4px;
  padding:8px 11px;font-size:13px;color:#5f6a77;}
.in-send{width:30px;height:30px;flex:0 0 auto;border:none;border-radius:4px;
  background:#E8A33D;color:#171B21;font-size:14px;font-weight:600;}

.in-nav{padding:9px 6px 13px;background:#1F252D;border-top:1px solid #2C343E;}
.in-nav a{color:#5f6a77;}
.in-nav a.on{color:#E8A33D;}
.in-nav span{font-family:var(--f-geistmono),monospace;font-size:8px;letter-spacing:.1em;text-transform:uppercase;}

/* ---- Bodega ---- */
.bo{background:#FFFDF7;color:#12100E;font-family:var(--f-jakarta),sans-serif;}
.bo-hd{display:flex;align-items:center;gap:11px;padding:14px 16px;
  background:#FFFDF7;border-bottom:2px solid #12100E;}
.bo-av{width:38px;height:38px;flex:0 0 auto;border-radius:11px;background:#FFD23F;
  border:2px solid #12100E;box-shadow:2px 2px 0 #12100E;display:grid;place-items:center;
  font-family:var(--f-bricolage),sans-serif;font-size:17px;font-weight:700;}
.bo-who{display:flex;flex-direction:column;gap:0;min-width:0;}
.bo-name{font-family:var(--f-bricolage),sans-serif;font-size:19px;font-weight:700;letter-spacing:-.025em;}
.bo-meta{font-size:11px;font-weight:600;color:#6b665c;}
.bo-streak{margin-left:auto;font-family:var(--f-bricolage),sans-serif;font-size:13px;font-weight:700;
  background:#FFD23F;border:2px solid #12100E;box-shadow:2px 2px 0 #12100E;
  border-radius:9px;padding:3px 9px;}

.bo-thread{padding:18px 16px 8px;display:flex;flex-direction:column;gap:13px;background:#F0EDE4;}
.bo-day{text-align:center;margin-bottom:2px;}
.bo-day span{font-family:var(--f-bricolage),sans-serif;font-size:10px;font-weight:700;
  letter-spacing:.1em;background:#12100E;color:#FFFDF7;padding:3px 10px;border-radius:20px;}
.bo-row{display:flex;}
.bo-row.is-mine{justify-content:flex-end;}
.bo-bub{max-width:76%;background:#FFFDF7;border:2px solid #12100E;box-shadow:2px 2px 0 #12100E;
  border-radius:13px;padding:9px 13px 7px;}
.bo-row.is-mine .bo-bub{background:#2B4CFF;color:#FFFDF7;}
.bo-bub p{margin:0 0 3px;font-size:14px;font-weight:500;line-height:1.45;}
.bo-time{font-size:9.5px;font-weight:700;color:#6b665c;letter-spacing:.03em;}
.bo-row.is-mine .bo-time{color:rgba(255,253,247,.72);}

.bo-comp{display:flex;align-items:center;gap:9px;padding:12px 14px;
  background:#FFFDF7;border-top:2px solid #12100E;}
.bo-clip{width:32px;height:32px;flex:0 0 auto;border:2px solid #12100E;border-radius:9px;
  background:#FFFDF7;box-shadow:2px 2px 0 #12100E;color:#12100E;font-size:16px;
  font-weight:700;line-height:1;}
.bo-field{flex:1;background:#F0EDE4;border:2px solid #12100E;border-radius:10px;
  padding:8px 12px;font-size:13.5px;font-weight:500;color:#6b665c;}
.bo-send{width:34px;height:34px;flex:0 0 auto;border:2px solid #12100E;border-radius:10px;
  background:#2B4CFF;box-shadow:2px 2px 0 #12100E;color:#FFFDF7;font-size:15px;font-weight:700;}

.bo-nav{padding:9px 6px 13px;background:#FFFDF7;border-top:2px solid #12100E;}
.bo-nav a{color:#6b665c;}
.bo-nav a.on{color:#2B4CFF;}
.bo-nav a.earn{background:#FFD23F;color:#12100E;border:2px solid #12100E;
  box-shadow:2px 2px 0 #12100E;border-radius:10px;padding:4px 9px;margin-top:-5px;}
.bo-nav span{font-size:8.5px;font-weight:700;letter-spacing:.02em;}

/* entrance */
.am-row,.in-row,.bo-row{animation:rise .34s cubic-bezier(.22,1,.36,1) backwards;
  animation-delay:calc(var(--i) * 42ms + 120ms);}
@keyframes rise{from{opacity:0;transform:translateY(7px);}to{opacity:1;transform:none;}}
@media (prefers-reduced-motion:reduce){.am-row,.in-row,.bo-row{animation:none;}}

@media (max-width:1320px){
  .rail{justify-content:flex-start;}
}
@media (max-width:460px){
  .frame,.cap{width:min(390px,calc(100vw - 48px));}
  .frame{height:min(760px,calc(100vh - 120px));}
}
`;
