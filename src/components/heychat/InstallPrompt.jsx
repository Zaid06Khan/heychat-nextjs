import { useEffect, useState } from 'react';
import { Download, X, Share } from 'lucide-react';

/**
 * "Add this to your home screen."
 *
 * THREE CONDITIONS BEFORE IT SHOWS, and each one exists because the banner is
 * otherwise noise:
 *
 *   - Not already installed. A launched PWA runs in `display-mode: standalone`,
 *     and inviting someone to install an app they are currently using inside is
 *     the clearest possible signal that nobody checked.
 *   - Mobile only. Installing is a home-screen action; on a desktop the browser
 *     already offers it in the address bar and this would just cover the chat.
 *   - Not dismissed before. Kept in localStorage, so "no" means no.
 *
 * IOS NEVER FIRES `beforeinstallprompt`. Safari has no programmatic install at
 * all — the only route is Share → Add to Home Screen — so on iPhone this shows
 * the instructions instead of a button that cannot exist. Without that branch
 * the banner simply never appeared on the platform this app is most used on,
 * which is also the platform where installing matters most: web push on iOS
 * only works once the app is on the home screen.
 */

const DISMISSED_KEY = 'heychat_install_dismissed';

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // Safari's own flag, which predates the standard media query.
    window.navigator.standalone === true
  );
}

function isIos() {
  return (
    /iphone|ipad|ipod/i.test(window.navigator.userAgent) ||
    // iPadOS 13+ reports itself as a Mac; the touch points give it away.
    (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1)
  );
}

function isMobile() {
  return isIos() || /android|mobile/i.test(window.navigator.userAgent);
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [show, setShow] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = Boolean(localStorage.getItem(DISMISSED_KEY));
    } catch {
      // Private mode. Treat as not dismissed rather than hiding for good.
    }
    if (dismissed || isStandalone() || !isMobile()) return undefined;

    // iOS has nothing to wait for — there is no event and never will be.
    if (isIos()) {
      setIos(true);
      setShow(true);
      return undefined;
    }

    const handler = (e) => {
      // Chrome fires this instead of showing its own mini-infobar once
      // preventDefault is called; the event is then ours to replay on a click.
      e.preventDefault();
      setDeferredPrompt(e);
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // Nothing more to offer once it is installed, whether from this banner or
    // from the browser's own menu.
    const installed = () => setShow(false);
    window.addEventListener('appinstalled', installed);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  const handleInstall = () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.finally(() => {
      // Either way the banner has said its piece. A declined install should not
      // leave the invitation sitting there.
      setShow(false);
      setDeferredPrompt(null);
    });
  };

  const handleDismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      /* nothing to remember it with */
    }
  };

  if (!show) return null;

  return (
    <div
      className="fixed left-4 right-4 z-50 animate-slide-up"
      // Clears the bottom nav, and the home indicator underneath it. Only
      // rendered inside AppLayout, so the nav is always there to clear.
      style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="bg-card border-2 border-foreground rounded-2xl shadow-pop p-4">
        <div className="flex items-start gap-3">
          <img
            src="/logo.png"
            alt=""
            aria-hidden="true"
            className="w-10 h-10 object-contain shrink-0"
          />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-foreground text-sm">Install Calamus3</p>
            <p className="text-muted-foreground text-xs mt-0.5">
              {ios
                ? 'Add it to your home screen to get notifications and open it like an app.'
                : 'Add it to your home screen for a full-screen app that opens instantly.'}
            </p>
          </div>
          <button
            onClick={handleDismiss}
            aria-label="Dismiss the install suggestion"
            className="text-muted-foreground hover:text-foreground shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {ios ? (
          // No button, because there is no API behind one. Naming the exact
          // menu items is the whole value here.
          <p className="mt-3 text-xs text-foreground bg-secondary rounded-xl px-3 py-2 flex items-center gap-1.5">
            Tap <Share className="w-3.5 h-3.5 inline shrink-0" aria-label="Share" />
            in Safari, then <span className="font-bold">Add to Home Screen</span>.
          </p>
        ) : (
          <button
            onClick={handleInstall}
            className="w-full mt-3 py-2.5 rounded-xl bg-accent text-accent-foreground border-2 border-foreground shadow-pop-sm text-sm font-bold hover:-translate-y-0.5 transition flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" /> Install
          </button>
        )}
      </div>
    </div>
  );
}
