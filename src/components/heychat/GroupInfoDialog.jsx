import { useEffect, useState } from 'react';
import { X, Crown, UserMinus, UserPlus, LogOut, Pencil, Check, AlertTriangle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { getSession } from '@/lib/heychatAuth';
import Avatar from './Avatar';
import { inviteMember, removeMember, leaveGroup, updateGroupDetails } from '@/lib/groups';

/**
 * Everything a group could not do until 0015: see who is in it, add and remove
 * people, rename it, and leave.
 *
 * Admin-only controls are hidden rather than disabled. A disabled "Remove"
 * button on every row would tell everyone what they cannot do, on every row,
 * forever. The server rejects the call regardless — this only decides what is
 * worth showing.
 */
export default function GroupInfoDialog({ open, onClose, conversation, members, onChanged }) {
  const session = getSession();
  const [name, setName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Invited people do not appear in the member list until they accept (0019),
  // so without this the row gives no sign anything happened and invites get
  // sent twice.
  const [invited, setInvited] = useState(new Set());

  const isAdmin = conversation?.admin_id === session?.id;

  useEffect(() => {
    setName(conversation?.name || '');
    setError('');
    setEditingName(false);
    setConfirmLeave(false);
  }, [conversation, open]);

  useEffect(() => {
    if (!search.trim() || search.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const found = await base44.entities.Account.filter({}, null, 200);
        const q = search.trim().toLowerCase();
        if (!cancelled) {
          setResults(
            found
              .filter(
                (a) =>
                  !conversation.participant_ids.includes(a.id) &&
                  ((a.username || '').toLowerCase().includes(q) ||
                    (a.display_name || '').toLowerCase().includes(q))
              )
              .slice(0, 5)
          );
        }
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, conversation]);

  if (!open || !conversation) return null;

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      onChanged?.();
    } catch (e) {
      // These messages come from the Postgres functions and are written to be
      // read by a person — "that person only accepts group invites from
      // contacts" — so they are shown rather than replaced with a generic one.
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm max-h-[85vh] overflow-y-auto bg-card border-2 border-foreground rounded-3xl shadow-pop-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h3 className="text-lg font-display font-extrabold text-foreground">Group info</h3>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-5">
          <div className="flex items-center gap-3">
            <Avatar src={conversation.cover_image} name={conversation.name || 'Group'} size={56} isGroup />
            <div className="flex-1 min-w-0">
              {editingName ? (
                <div className="flex items-center gap-1.5">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={80}
                    className="flex-1 min-w-0 bg-secondary border-2 border-foreground rounded-lg px-2 py-1 text-sm outline-none"
                  />
                  <button
                    onClick={() => run(async () => {
                      await updateGroupDetails(conversation.id, { name });
                      setEditingName(false);
                    })}
                    disabled={busy || !name.trim()}
                    aria-label="Save name"
                    className="w-8 h-8 rounded-lg bg-primary text-primary-foreground border-2 border-foreground flex items-center justify-center disabled:opacity-40"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <p className="font-display font-extrabold text-foreground truncate">
                    {conversation.name || 'Group'}
                  </p>
                  {isAdmin && (
                    <button onClick={() => setEditingName(true)} aria-label="Rename group" className="text-muted-foreground hover:text-foreground">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-0.5">
                {conversation.participant_ids.length} member
                {conversation.participant_ids.length === 1 ? '' : 's'}
              </p>
            </div>
          </div>

          {isAdmin && (
            <div>
              <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1.5 block">
                Invite someone
              </label>
              <div className="flex items-center gap-2 bg-secondary border-2 border-foreground rounded-xl px-3 py-2">
                <UserPlus className="w-4 h-4 text-muted-foreground shrink-0" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by username..."
                  className="flex-1 min-w-0 bg-transparent outline-none text-sm"
                />
              </div>
              {results.map((a) => (
                <button
                  key={a.id}
                  onClick={() => run(async () => {
                    await inviteMember(conversation.id, a.id);
                    setSearch('');
                    setInvited((prev) => new Set(prev).add(a.id));
                  })}
                  disabled={busy}
                  className="w-full flex items-center gap-2 p-2 mt-1 rounded-xl hover:bg-secondary transition text-left"
                >
                  <Avatar src={a.avatar} name={a.display_name || a.username} size={28} />
                  <span className="text-sm text-foreground truncate">{a.display_name || a.username}</span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {invited.has(a.id) ? 'Invited' : 'Invite'}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Members</p>
            <div className="space-y-1">
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-2 p-1.5 rounded-xl">
                  <Avatar src={m.avatar} name={m.display_name || m.username} size={32} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">
                      {m.id === session.id ? 'You' : m.display_name || m.username}
                    </p>
                  </div>
                  {conversation.admin_id === m.id && (
                    <span className="flex items-center gap-1 text-[10px] font-bold uppercase text-primary">
                      <Crown className="w-3 h-3" /> Admin
                    </span>
                  )}
                  {isAdmin && m.id !== session.id && (
                    <button
                      onClick={() => run(() => removeMember(conversation.id, m.id))}
                      disabled={busy}
                      aria-label={`Remove ${m.display_name || m.username}`}
                      className="text-muted-foreground hover:text-destructive transition"
                    >
                      <UserMinus className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-xs text-destructive flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {error}
            </p>
          )}

          {confirmLeave ? (
            <div className="rounded-xl border-2 border-destructive/40 bg-destructive/10 p-3">
              <p className="text-sm text-foreground mb-2">
                Leave this group?
                {isAdmin && members.length > 1 && ' Someone else will become admin.'}
                {members.length === 1 && ' You are the last member, so it will be deleted.'}
              </p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmLeave(false)} className="flex-1 py-2 rounded-lg bg-secondary text-sm font-medium">
                  Cancel
                </button>
                <button
                  onClick={() => run(async () => {
                    await leaveGroup(conversation.id);
                    onClose();
                  })}
                  disabled={busy}
                  className="flex-1 py-2 rounded-lg bg-destructive text-white text-sm font-semibold disabled:opacity-40"
                >
                  Leave
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmLeave(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm font-semibold hover:bg-destructive/20 transition"
            >
              <LogOut className="w-4 h-4" /> Leave group
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
