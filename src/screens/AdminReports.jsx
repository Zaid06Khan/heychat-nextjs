import { apiFetch } from '@/lib/api';

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ShieldAlert, Ban, Check, X, RotateCcw } from 'lucide-react';
import Avatar from '@/components/heychat/Avatar';

/**
 * The moderation queue.
 *
 * Reports have been written since 0001 and nothing ever read them — no queue,
 * no admin, and no way to act on one. This is the other half.
 *
 * IT IS NOT ROUTE-GUARDED IN THE BROWSER, DELIBERATELY. Both endpoints behind
 * it answer 404 to anyone who is not an admin, so a non-admin who finds the URL
 * gets an empty screen and a "not found" — the check that matters is on the
 * server, and a client-side redirect would only be decoration over it.
 */

const TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'actioned', label: 'Actioned' },
  { key: 'dismissed', label: 'Dismissed' },
  { key: 'all', label: 'All' },
];

const REASONS = {
  spam: 'Spam',
  harassment: 'Harassment',
  inappropriate_content: 'Inappropriate content',
  fake_account: 'Fake account',
  threats: 'Threats',
  other: 'Other',
};

export default function AdminReports() {
  const [status, setStatus] = useState('pending');
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [notes, setNotes] = useState({});
  const [error, setError] = useState('');

  const load = async (which = status) => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`/api/admin/reports?status=${which}`);
      if (res.status === 404 || res.status === 401) {
        setDenied(true);
        setReports([]);
        return;
      }
      const json = await res.json();
      setReports(json.reports || []);
    } catch {
      setError('Could not load reports.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(status); }, [status]);

  const act = async (report, action) => {
    setBusyId(report.id);
    setError('');
    try {
      const res = await apiFetch('/api/admin/moderate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report_id: report.id,
          subject_id: report.reported_id,
          action,
          note: notes[report.id] || '',
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error || 'That action could not be applied.');
        return;
      }
      setNotes((n) => ({ ...n, [report.id]: '' }));
      await load(status);
    } catch {
      setError('That action could not be applied.');
    } finally {
      setBusyId(null);
    }
  };

  if (denied) {
    return (
      <div className="flex flex-col h-full bg-background items-center justify-center px-6 text-center">
        <p className="text-lg font-display font-extrabold text-foreground">Not found</p>
        <Link to="/home" className="text-sm text-primary mt-2">Back to chats</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background overflow-y-auto">
      <div className="border-b-2 border-foreground bg-background sticky top-0 z-10">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto w-full">
          <Link to="/settings" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-2xl font-display font-extrabold text-foreground flex-1 flex items-center gap-2">
            <ShieldAlert className="w-5 h-5" /> Reports
          </h1>
        </div>
      </div>

      <div className="p-4 space-y-4 max-w-3xl mx-auto w-full">
        <div className="flex gap-2 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setStatus(t.key)}
              className={`shrink-0 py-2 px-4 rounded-xl text-sm font-medium transition ${
                status === t.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-3">
            {error}
          </p>
        )}

        {loading ? (
          <p className="text-center text-sm text-muted-foreground py-8">Loading…</p>
        ) : reports.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">
            Nothing here. {status === 'pending' && 'No reports are waiting.'}
          </p>
        ) : (
          <div className="space-y-3">
            {reports.map((r) => {
              const who = r.reported?.display_name || r.reported?.username || 'Unknown';
              const by = r.reporter?.username || 'unknown';
              const isSuspended = Boolean(r.reported?.suspended_at);
              return (
                <div key={r.id} className="bg-card border-2 border-foreground rounded-2xl shadow-pop-sm p-4">
                  <div className="flex items-start gap-3">
                    <Avatar src={r.reported?.avatar} name={who} size={40} />
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-foreground text-sm truncate">
                        {who}
                        {isSuspended && (
                          <span className="ml-2 text-[10px] font-extrabold uppercase tracking-wide text-destructive">
                            Suspended
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        @{r.reported?.username || '—'} · reported by @{by}
                      </p>
                    </div>
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-secondary text-muted-foreground">
                      {r.status}
                    </span>
                  </div>

                  <p className="mt-3 text-sm font-semibold text-foreground">
                    {REASONS[r.reason] || r.reason}
                  </p>
                  {r.description && (
                    <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap break-words">
                      {r.description}
                    </p>
                  )}
                  <p className="mt-2 text-[11px] text-muted-foreground tabular-nums">
                    {new Date(r.created_date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>

                  <input
                    value={notes[r.id] || ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                    placeholder="Note (recorded with the decision)"
                    className="w-full mt-3 bg-secondary rounded-xl px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary"
                  />

                  <div className="flex flex-wrap gap-2 mt-3">
                    <button
                      onClick={() => act(r, 'dismissed')}
                      disabled={busyId === r.id}
                      className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-secondary text-foreground border-2 border-foreground shadow-pop-sm disabled:opacity-50 transition"
                    >
                      <X className="w-3.5 h-3.5" /> Dismiss
                    </button>
                    <button
                      onClick={() => act(r, 'reviewed')}
                      disabled={busyId === r.id}
                      className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-secondary text-foreground border-2 border-foreground shadow-pop-sm disabled:opacity-50 transition"
                    >
                      <Check className="w-3.5 h-3.5" /> Reviewed, no action
                    </button>
                    {isSuspended ? (
                      <button
                        onClick={() => act(r, 'unsuspended')}
                        disabled={busyId === r.id}
                        className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-accent text-accent-foreground border-2 border-foreground shadow-pop-sm disabled:opacity-50 transition"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> Unsuspend
                      </button>
                    ) : (
                      <button
                        onClick={() => act(r, 'suspended')}
                        disabled={busyId === r.id}
                        className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-destructive text-destructive-foreground border-2 border-foreground shadow-pop-sm disabled:opacity-50 transition"
                      >
                        <Ban className="w-3.5 h-3.5" /> Suspend account
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Said once, where the decision is made: suspension is not instant. */}
        <p className="text-xs text-muted-foreground">
          Suspending blocks new sign-ins and revokes saved sessions. A browser
          already open keeps working until its access token expires, usually
          within the hour.
        </p>
      </div>
    </div>
  );
}
