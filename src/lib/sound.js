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
 * A short rising two-note blip. Quiet on purpose — this fires while the person
 * is already looking at the app, so it needs to be noticeable rather than loud.
 *
 * Never throws. A sound that fails is not a reason for anything else to fail,
 * and audio is blocked often enough (autoplay policy, muted device, no output)
 * that treating it as an error would be wrong.
 */
export function playMessageSound() {
  if (!isSoundEnabled()) return;

  try {
    const audio = getContext();
    if (!audio) return;

    const now = audio.currentTime;
    // E5 then A5 — a small rising interval reads as "arrived" rather than
    // "something is wrong", which a falling one does.
    [
      { freq: 659.25, at: 0, len: 0.09 },
      { freq: 880.0, at: 0.085, len: 0.13 },
    ].forEach(({ freq, at, len }) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;

      // An envelope rather than a bare start/stop: cutting a sine off at full
      // amplitude produces an audible click, which sounds like a glitch.
      gain.gain.setValueAtTime(0, now + at);
      gain.gain.linearRampToValueAtTime(0.09, now + at + 0.012);
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
