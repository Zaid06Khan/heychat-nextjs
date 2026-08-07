import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { getSession } from '@/lib/heychatAuth';
import { Flag, X } from 'lucide-react';

const REASONS = [
  { value: 'spam', label: 'Spam or scam' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'inappropriate_content', label: 'Inappropriate content' },
  { value: 'fake_account', label: 'Fake or impersonation' },
  { value: 'threats', label: 'Threats or violence' },
  { value: 'other', label: 'Other' },
];

export default function ReportDialog({ open, onClose, reportedId, reportedName, onBlocked }) {
  const [reason, setReason] = useState('spam');
  const [description, setDescription] = useState('');
  const [blockUser, setBlockUser] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const session = getSession();

  if (!open) return null;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await base44.entities.Report.create({
        reporter_id: session.id,
        reported_id: reportedId,
        reported_username: reportedName,
        reason,
        description: description.trim(),
        status: 'pending',
      });
      if (blockUser) {
        const blocked = session.blocked_account_ids || [];
        const updated = [...new Set([...blocked, reportedId])];
        await base44.entities.Account.update(session.id, { blocked_account_ids: updated });
        const sessionData = JSON.parse(localStorage.getItem('heychat_session') || '{}');
        sessionData.blocked_account_ids = updated;
        localStorage.setItem('heychat_session', JSON.stringify(sessionData));
        if (onBlocked) onBlocked();
      }
      setReason('spam');
      setDescription('');
      setBlockUser(false);
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-card border border-border rounded-3xl p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-destructive/20 flex items-center justify-center">
              <Flag className="w-5 h-5 text-destructive" />
            </div>
            <h3 className="text-lg font-heading font-bold text-foreground">Report {reportedName}</h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Report this user for misbehaviour or inappropriate content. The HeyChat team will review your report and take appropriate action.
        </p>
        <div className="space-y-2 mb-4">
          {REASONS.map((r) => (
            <button
              key={r.value}
              onClick={() => setReason(r.value)}
              className={`w-full text-left px-4 py-2.5 rounded-xl text-sm transition ${
                reason === r.value ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground hover:bg-secondary/70'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Add details (optional)"
          rows={3}
          className="w-full bg-secondary rounded-xl px-4 py-3 text-foreground outline-none mb-4 resize-none text-sm"
        />
        <label className="flex items-center gap-2 mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={blockUser}
            onChange={(e) => setBlockUser(e.target.checked)}
            className="w-4 h-4 accent-primary"
          />
          <span className="text-sm text-foreground">Also block this user</span>
        </label>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full py-3 rounded-xl bg-destructive text-white font-semibold disabled:opacity-50 hover:opacity-90 transition"
        >
          {submitting ? 'Submitting...' : 'Submit Report'}
        </button>
      </div>
    </div>
  );
}