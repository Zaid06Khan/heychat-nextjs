'use client';

import { useCallback, useEffect, useState } from 'react';
import { HardDrive, RefreshCw, Check } from 'lucide-react';
import { clearSignedMediaCache } from '@/lib/media/useSignedMedia';

/**
 * How much of this device Calamus3 is using, and a way to give it back.
 *
 * WORTH BEING HONEST ABOUT WHAT THIS CAN REACH. Messages and photos live on the
 * server and are fetched on demand, so this app has no local message store to
 * prune — clearing here loses nothing and hides nothing. What it can drop is
 * everything the origin has accumulated in quota-managed storage: the Cache
 * Storage API, IndexedDB, and the parts of localStorage that are caches rather
 * than preferences.
 *
 * The one thing it CANNOT reach is the browser's own HTTP cache, which is where
 * downloaded photos actually sit. No page can evict that; only the browser's
 * own settings can. Saying so is better than a button that quietly does less
 * than it claims.
 */

// Preferences, not caches. These survive — clearing storage should not sign you
// out, unmute your sounds, or forget that you dismissed the install prompt.
const KEEP_PREFIXES = [
  'heychat_session',
  'heychat_install_dismissed',
  'calamuse_sound_enabled',
  'calamus3_remembered_username',
];

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value < 10 && i > 0 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

export default function StorageSettings() {
  const [usage, setUsage] = useState(null);
  const [supported, setSupported] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);

  const measure = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
      setSupported(false);
      return;
    }
    try {
      const { usage: used } = await navigator.storage.estimate();
      setUsage(used ?? 0);
    } catch {
      setSupported(false);
    }
  }, []);

  useEffect(() => { measure(); }, [measure]);

  const clear = async () => {
    setClearing(true);
    setCleared(false);
    try {
      // 1. Cache Storage. Nothing writes to it today — the service worker is
      //    notifications-only and deliberately not an offline cache — but a
      //    previous version of it may have, and those entries would otherwise
      //    sit there forever.
      if (typeof caches !== 'undefined') {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n)));
      }

      // 2. localStorage, minus the preferences above.
      try {
        const doomed = [];
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i);
          if (key && !KEEP_PREFIXES.some((k) => key.startsWith(k))) doomed.push(key);
        }
        doomed.forEach((k) => localStorage.removeItem(k));
      } catch {
        // Storage disabled. Nothing to clear.
      }

      // 3. Signed URLs held in memory for this tab.
      clearSignedMediaCache();

      setCleared(true);
    } catch (e) {
      console.error(e);
    } finally {
      setClearing(false);
      measure();
    }
  };

  return (
    <div className="bg-card border-2 border-foreground rounded-2xl shadow-pop-sm p-4">
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-full bg-secondary border-2 border-foreground flex items-center justify-center shrink-0">
          <HardDrive className="w-4 h-4 text-foreground" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-foreground">On this device</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {!supported
              ? 'This browser will not report storage usage'
              : usage === null
                ? 'Measuring…'
                : `${formatBytes(usage)} used`}
          </p>
        </div>
        <button
          onClick={clear}
          disabled={clearing}
          className="shrink-0 text-xs font-bold px-3 py-2 rounded-lg bg-secondary text-foreground border-2 border-foreground shadow-pop-sm hover:-translate-y-0.5 disabled:opacity-50 disabled:translate-y-0 transition flex items-center gap-1.5"
        >
          {clearing ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : cleared ? (
            <Check className="w-3.5 h-3.5" />
          ) : null}
          {clearing ? 'Clearing…' : cleared ? 'Cleared' : 'Clear cached data'}
        </button>
      </div>

      <p className="text-xs text-muted-foreground mt-3">
        Your messages and photos are stored on the server, not on your phone, so
        clearing this deletes nothing and signs you out of nothing — the app just
        downloads what it needs again.
      </p>
      <p className="text-xs text-muted-foreground mt-2">
        Photos you have already viewed are held in your browser&apos;s own cache,
        which no website is allowed to empty. To reclaim that space, clear site
        data for this app in your browser settings.
      </p>
    </div>
  );
}
