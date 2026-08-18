'use client';

/**
 * The in-app "you got a message" sound.
 *
 * SYNTHESISED, NOT A FILE. Two short sine tones through the Web Audio API
 * rather than an mp3 in `public/`. No asset to 404, no format matrix
 * (Safari and Chrome disagree about ogg), nothing to cache-bust, and it works
 * offline. It is about forty lines and swapping a real designed sound in later
 * means changing only `playMessageSound`.
 *
 * WHAT THIS IS NOT: the sound a *push notification* makes. That one belongs to
 * the operating system — the Web Notification API has no usable way to set a
 * custom sound, so on a locked phone you get the OS default and nothing here is
 * involved. A custom push sound needs a native build shipping an APNs/FCM sound
 * file. See docs/DEPLOY.md.
 *
 * PER DEVICE, ON PURPOSE. The preference lives in localStorage rather than on
 * the account, because wanting sound on your laptop and silence on your phone
 * is the normal case, not an edge one. That also means no migration.
 */

// STILL SAYS `calamuse`, AND SHOULD. The app was renamed to Calamus3 on
// 2026-08-18, but this string is a key in every existing browser's
// localStorage. Renaming it silently resets the preference of everyone who had
// turned sound off, which is the one group that would notice. Same reasoning as
// HEYCHAT_SYNTHETIC_EMAIL_DOMAIN in lib/auth/shared.js.
const KEY = 'calamuse_sound_enabled';

export function isSoundEnabled() {
  if (typeof window === 'undefined') return false;
  // Default ON. An explicit '0' is the only thing that turns it off, so a
  // browser with no stored preference behaves like every other messenger.
  return localStorage.getItem(KEY) !== '0';
}

export function setSoundEnabled(enabled) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, enabled ? '1' : '0');
}

let ctx = null;
let primed = false;

/**
 * One AudioContext for the page, created on first use.
 *
 * Browsers refuse to start one before the user has interacted with the page, so
 * creating it eagerly on load produces a permanently suspended context. By the
 * time a message arrives the person has signed in, which counts — but a context
 * can still be suspended after a tab restore, hence the resume().
 */
function getContext() {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!ctx) ctx = new AudioCtx();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/**
 * Wake the audio system on the first real user gesture.
 *
 * Browsers refuse to run an AudioContext until the document has been
 * interacted with, and a context created before that stays `suspended` — which
 * looks exactly like working code: oscillators get created, scheduled, and make
 * no sound at all. `resume()` is itself ignored without a gesture, so calling
 * it at play time only helps if the person happened to click recently.
 *
 * The case that broke: sign in (a click, so audio works), then reload or come
 * back to a restored session. The new document has had no gesture, a message
 * arrives, and nothing is heard. Every automated test missed it because
 * driving a browser means clicking things.
 *
 * Called once from the app shell. `once: true` on each listener, and the
 * context is created here so the very first sound is already running.
 */
export function primeAudio() {
  if (primed || typeof window === 'undefined') return;
  primed = true;

  const wake = () => {
    try {
      const audio = getContext();
      // Created inside a gesture handler, so this resume is the one that counts.
      if (audio && audio.state === 'suspended') audio.resume().catch(() => {});
    } catch {
      /* no audio device, or a browser that refuses. Nothing to do. */
    }
  };

  for (const evt of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(evt, wake, { once: true, passive: true });
  }
}

/**
 * A short rising two-note blip. Quiet on purpose — this fires while the person
 * is already looking at the app, so it needs to be noticeable rather than loud.
 *
 * Never throws. A sound that fails is not a reason for anything else to fail,
 * and audio is blocked often enough (autoplay policy, muted device, no output)
 * that treating it as an error would be wrong.
 */
export function playMessageSound() {
  play([
    { freq: 659.25, at: 0, len: 0.09 },
    { freq: 880.0, at: 0.085, len: 0.13 },
  ], 0.28);
}

/**
 * The outgoing "sent" sound. One note, lower and quieter than the arrival blip.
 *
 * Deliberately different, and deliberately smaller. You already know you sent
 * it — the sound is confirmation, not news — so it must not compete with the
 * one that means somebody is talking to you. A single low note against a rising
 * pair is distinguishable without having to think about it.
 */
export function playSentSound() {
  play([{ freq: 392.0, at: 0, len: 0.075 }], 0.16);
}

/**
 * @param {boolean} [force] play even when message sounds are switched off.
 *   Used only by ringing — see startRinging for why that is not the same
 *   preference.
 */
function play(notes, peak, force = false) {
  if (!force && !isSoundEnabled()) return;

  try {
    const audio = getContext();
    if (!audio) return;

    const now = audio.currentTime;
    notes.forEach(({ freq, at, len }) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;

      // An envelope rather than a bare start/stop: cutting a sine off at full
      // amplitude produces an audible click, which sounds like a glitch.
      gain.gain.setValueAtTime(0, now + at);
      gain.gain.linearRampToValueAtTime(peak, now + at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + len);

      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(now + at);
      osc.stop(now + at + len + 0.02);
    });
  } catch {
    // Autoplay blocked, no audio device, context dead after a restore. All of
    // them mean "no sound", none of them mean "something went wrong".
  }
}

/* ------------------------------------------------------------------ ringing */

let ringTimer = null;

/**
 * Ringing, on both sides of a call.
 *
 * A repeating pattern rather than one blip, because a ring has to last as long
 * as the question does — a single chirp for an incoming call is missable, which
 * is the whole failure it exists to prevent.
 *
 * IGNORES THE MESSAGE-SOUND TOGGLE, deliberately. That switch says "Sound for
 * new messages"; someone who silences message pings has not asked to miss phone
 * calls, and silently reading it that way would be the app deciding something
 * it was not told.
 *
 * @param {'incoming'|'outgoing'} kind
 */
export function startRinging(kind) {
  stopRinging();

  const pattern =
    kind === 'incoming'
      ? // Two rising pairs — insistent, clearly "answer me".
        { notes: [
            { freq: 587.33, at: 0, len: 0.18 },
            { freq: 783.99, at: 0.22, len: 0.22 },
            { freq: 587.33, at: 0.62, len: 0.18 },
            { freq: 783.99, at: 0.84, len: 0.22 },
          ], peak: 0.34, every: 2600 }
      : // Ringback: one long low tone, the sound of waiting rather than of being
        // summoned. Quieter, since it is your own phone telling you it is trying.
        { notes: [{ freq: 440.0, at: 0, len: 0.9 }], peak: 0.14, every: 3000 };

  const fire = () => play(pattern.notes, pattern.peak, true);
  fire();
  ringTimer = setInterval(fire, pattern.every);
}

export function stopRinging() {
  if (ringTimer) {
    clearInterval(ringTimer);
    ringTimer = null;
  }
}
