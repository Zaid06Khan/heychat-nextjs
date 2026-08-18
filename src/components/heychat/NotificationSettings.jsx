import { useEffect, useState } from 'react';
import { isSoundEnabled, setSoundEnabled, playMessageSound } from '@/lib/sound';
import { Bell, BellOff, AlertTriangle, EyeOff, Volume2 } from 'lucide-react';
import { enablePush, disablePush, getPushState } from '@/lib/push/client';
import { base44 } from '@/api/base44Client';

/**
 * The notification opt-in.
 *
 * It lives behind a click on purpose. Browsers only grant one permission
 * request per origin and Chrome permanently blocks sites that ask on page load,
 * so asking at the moment someone deliberately reaches for the switch is the
 * only chance worth spending.
 *
 * The states are reported separately rather than as one on/off, because a user
 * whose browser has *denied* the permission cannot be helped by the toggle at
 * all — only by their browser's site settings — and a toggle that silently does
 * nothing is worse than one that explains itself.
 */
export default function NotificationSettings({ account, onAccountChange }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Read in an effect, not as an initialiser: localStorage does not exist
  // during the server render, and reading it inline would make the first client
  // render disagree with the HTML.
  const [sound, setSound] = useState(true);

  useEffect(() => {
    setSound(isSoundEnabled());
  }, []);

  useEffect(() => {
    getPushState().then(setState);
  }, []);

  const togglePreview = async (hide) => {
    // Optimistic: the switch should move under the finger. A failure here is
    // recoverable by flipping it again, and the server is the one that actually
    // enforces this on every send.
    onAccountChange?.({ ...account, hide_notification_preview: hide });
    try {
      await base44.entities.Account.update(account.id, { hide_notification_preview: hide });
    } catch {
      onAccountChange?.({ ...account, hide_notification_preview: !hide });
      setError('Could not save that setting.');
    }
  };

  const toggle = async () => {
    setBusy(true);
    setError('');
    try {
      if (state?.subscribed) {
        await disablePush();
      } else {
        const result = await enablePush();
        if (!result.ok) {
          setError(
            result.reason === 'denied'
              ? 'Your browser is blocking notifications for this site. Turn them back on in its site settings.'
              : result.reason === 'not-configured'
                ? 'Notifications are not configured on this server yet.'
                : 'Could not turn notifications on.'
          );
        }
      }
      setState(await getPushState());
    } catch {
      setError('Could not change that setting.');
    } finally {
      setBusy(false);
    }
  };

  if (!state) return null;

  const unavailable = !state.supported || !state.configured;
  const blocked = state.permission === 'denied';
  const on = state.subscribed;

  return (
    <div>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
        <Bell className="w-4 h-4" /> Notifications
      </h2>
      <div className="bg-card rounded-2xl border border-border p-2">
        <div className="flex items-center justify-between p-3 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {on ? (
              <Bell className="w-5 h-5 text-primary shrink-0" />
            ) : (
              <BellOff className="w-5 h-5 text-muted-foreground shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Message notifications</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {unavailable
                  ? 'Not available in this browser'
                  : blocked && !on
                    ? 'Blocked in your browser settings'
                    : on
                      ? 'On for this device'
                      : 'Get notified when a message arrives while the app is closed'}
              </p>
            </div>
          </div>
          <button
            onClick={toggle}
            disabled={busy || unavailable || (blocked && !on)}
            aria-pressed={on}
            className={`shrink-0 px-4 py-2 rounded-xl text-sm font-semibold border-2 border-foreground transition disabled:opacity-40 disabled:cursor-not-allowed ${
              on
                ? 'bg-secondary text-foreground'
                : 'bg-primary text-primary-foreground shadow-pop-sm hover:-translate-y-0.5'
            }`}
          >
            {busy ? '…' : on ? 'Turn off' : 'Turn on'}
          </button>
        </div>

        {/* Not a caveat worth hiding: on iPhone, web push only works once the
            app has been added to the home screen. Someone who taps "Turn on" in
            mobile Safari and gets nothing deserves to know why. */}
        {!unavailable && !on && (
          <p className="text-xs text-muted-foreground px-3 pb-2">
            On iPhone, add Calamus3 to your home screen first — Safari only delivers
            notifications to installed apps.
          </p>
        )}

        {on && (
          <p className="text-xs text-muted-foreground px-3 pb-2">
            This is per device. Turning it on here does not turn it on elsewhere.
          </p>
        )}

        {/* Only meaningful once something is actually being delivered. Shown
            below the switch rather than as its own section because it modifies
            the thing above it. Unlike the switch, this one IS per account —
            hiding previews on your phone but not your laptop would defeat it. */}
        {on && account && (
          <label className="flex items-center justify-between gap-3 cursor-pointer p-3 border-t border-border">
            <div className="flex items-center gap-3 min-w-0">
              <EyeOff className="w-5 h-5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Hide message preview</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Show only &ldquo;New message&rdquo; — no sender, no text. Applies to every
                  device you use.
                </p>
              </div>
            </div>
            <input
              type="checkbox"
              checked={account.hide_notification_preview || false}
              onChange={(e) => togglePreview(e.target.checked)}
              className="w-5 h-5 accent-primary shrink-0"
            />
          </label>
        )}

        {/* Deliberately outside the push switch's `on &&`. This is a different
            channel: the in-app sound works whether or not notifications are
            enabled, because it plays while you are looking at the app rather
            than on a lock screen. Per device, like the switch above. */}
        <label className="flex items-center justify-between gap-3 cursor-pointer p-3 border-t border-border">
          <div className="flex items-center gap-3 min-w-0">
            <Volume2 className="w-5 h-5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Sound for new messages</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Plays while the app is open. Muted conversations stay silent.
              </p>
            </div>
          </div>
          <input
            type="checkbox"
            checked={sound}
            onChange={(e) => {
              setSound(e.target.checked);
              setSoundEnabled(e.target.checked);
              // Play it on the way on, so "what does it sound like" is answered
              // by turning it on rather than by waiting for a message. This is
              // also a real user gesture, which is what unblocks the
              // AudioContext for the rest of the session.
              if (e.target.checked) playMessageSound();
            }}
            className="w-5 h-5 accent-primary shrink-0"
          />
        </label>

        {error && (
          <p className="text-xs text-destructive px-3 pb-2 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {error}
          </p>
        )}
      </div>
    </div>
  );
}
