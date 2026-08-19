import { useState, useEffect } from 'react';
import { getAccountsById } from '@/lib/accounts';
import { getContactIds } from '@/lib/contacts';
import { createConversation } from '@/lib/conversations';
import { getSession } from '@/lib/heychatAuth';
import { X, Users, Check } from 'lucide-react';
import Avatar from './Avatar';

export default function GroupCreateDialog({ open, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [contacts, setContacts] = useState([]);
  const [selected, setSelected] = useState({});
  const session = getSession();

  useEffect(() => {
    if (!open) return;
    (async () => {
      // Two reads instead of two plus one per contact.
      const contactIds = await getContactIds(session.id);
      const people = await getAccountsById([...contactIds]);
      setContacts([...contactIds].map((id) => people.get(id)).filter(Boolean));
    })();
  }, [open]);

  const handleCreate = async () => {
    const memberIds = Object.keys(selected).filter((k) => selected[k]);
    if (!name.trim() || memberIds.length === 0) return;
    const participant_ids = [session.id, ...memberIds];
    const conv = await createConversation({
      type: 'group',
      participant_ids,
      name: name.trim(),
      cover_image: '',
      disappearing_timer: 0,
      admin_id: session.id,
    });
    setName('');
    setSelected({});
    onCreated?.(conv);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div
        className="w-full md:max-w-md bg-card border border-border rounded-t-3xl md:rounded-3xl p-5 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-heading font-bold text-foreground flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" /> New Group
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Group name"
          className="w-full bg-secondary rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none mb-4"
        />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Select members</p>
        <div className="max-h-64 overflow-y-auto space-y-1">
          {contacts.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No contacts yet. Add some first!</p>
          )}
          {contacts.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected((s) => ({ ...s, [c.id]: !s[c.id] }))}
              className={`w-full flex items-center gap-3 p-2 rounded-xl transition ${
                selected[c.id] ? 'bg-primary/10' : 'hover:bg-secondary/50'
              }`}
            >
              <Avatar src={c.avatar} name={c.display_name || c.username} size={40} />
              <div className="flex-1 text-left min-w-0">
                <p className="font-medium text-foreground text-sm truncate">{c.display_name || c.username}</p>
                <p className="text-xs text-muted-foreground truncate">@{c.username}</p>
              </div>
              <div
                className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition ${
                  selected[c.id] ? 'bg-primary border-primary' : 'border-border'
                }`}
              >
                {selected[c.id] && <Check className="w-3 h-3 text-white" />}
              </div>
            </button>
          ))}
        </div>
        <button
          onClick={handleCreate}
          disabled={!name.trim() || Object.values(selected).filter(Boolean).length === 0}
          className="w-full mt-4 py-3 rounded-xl gradient-bg text-white font-semibold disabled:opacity-40 hover:opacity-90 transition"
        >
          Create Group
        </button>
      </div>
    </div>
  );
}