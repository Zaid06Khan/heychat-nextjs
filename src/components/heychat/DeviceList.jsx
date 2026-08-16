import { useEffect, useState } from 'react';
import { Smartphone, Loader2 } from 'lucide-react';
import { listDevices, revokeDevice, describeDevice } from '@/lib/devices';

/**
 * Where "this account is bound to this device's fingerprint" used to be.
 *
 * That panel described a constraint that made the app unusable on a second
 * device; this one lists the sessions that actually exist and lets you end any
 * of them. See FOLLOWUPS #6 and 0018.
 *
 * DEGRADES QUIETLY WHEN 0018 IS NOT APPLIED. Migrations here are applied by
 * hand, so a tree with this code and without the function is a real state. The
 * panel says so rather than showing a raw PostgREST error about a missing
 * function, which would read as a bug in the app.
 */
export default function DeviceList() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    try {
      setDevices(await listDevices());
      setError('');
    } catch (e) {
      setError(
        /list_my_devices/i.test(e.message || '')
          ? 'Needs migration 0018 — run npm run db:migrate.'
          : e.message || 'Could not load your devices.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleRevoke = async (id) => {
    setBusyId(id);
    try {
      await revokeDevice(id);
      await load();
    } catch (e) {
      setError(e.message || 'Could not sign that device out.');
    } finally {
      setBusyId(null);
    }
  };

  const when = (iso) => {
    if (!iso) return '';
    const then = new Date(iso);
    const mins = Math.round((Date.now() - then.getTime()) / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return `${mins} minutes ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  };

  return (
    <div className="bg-card rounded-2xl border border-border p-4 space-y-3">
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading devices…
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : devices.length === 0 ? (
        <p className="text-sm text-muted-foreground">No other sessions.</p>
      ) : (
        devices.map((d) => (
          <div key={d.id} className="flex items-center gap-3">
            <Smartphone className="w-5 h-5 text-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {describeDevice(d.user_agent)}
                {d.is_current && (
                  <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-primary">
                    This device
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Last used {when(d.last_seen_at)}
                {d.ip ? ` · ${d.ip}` : ''}
              </p>
            </div>
            {/* The current session is ended by Log out, which also clears the
                cookie. Offering it here would leave this page holding a dead
                session with no idea it had happened. */}
            {!d.is_current && (
              <button
                onClick={() => handleRevoke(d.id)}
                disabled={busyId === d.id}
                className="shrink-0 text-xs font-semibold text-destructive hover:underline disabled:opacity-50"
              >
                {busyId === d.id ? 'Signing out…' : 'Sign out'}
              </button>
            )}
          </div>
        ))
      )}
      <p className="text-xs text-muted-foreground pt-1 border-t border-border">
        Signing a device out stops it renewing its session. It can take up to an
        hour to take effect on a device that is currently open.
      </p>
    </div>
  );
}
