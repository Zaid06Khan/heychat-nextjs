import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { getSession } from '@/lib/heychatAuth';
import { ArrowLeft, Users, Check, X } from 'lucide-react';
import Avatar from '@/components/heychat/Avatar';
import ContactSearch from '@/components/heychat/ContactSearch';
import GroupCreateDialog from '@/components/heychat/GroupCreateDialog';
import DiscoverSuggestions from '@/components/heychat/DiscoverSuggestions';

export default function Contacts() {
  const [tab, setTab] = useState('contacts');
  const [contacts, setContacts] = useState([]);
  const [requests, setRequests] = useState([]);
  const [showGroup, setShowGroup] = useState(false);
  const session = getSession();
  const navigate = useNavigate();

  const loadData = async () => {
    const sent = await base44.entities.ContactRequest.filter({ from_account_id: session.id, status: 'accepted' });
    const received = await base44.entities.ContactRequest.filter({ to_account_id: session.id, status: 'accepted' });
    const contactIds = new Set([
      ...sent.map((r) => r.to_account_id),
      ...received.map((r) => r.from_account_id),
    ]);
    const accs = await Promise.all(
      Array.from(contactIds).map((id) => base44.entities.Account.get(id).catch(() => null))
    );
    setContacts(accs.filter(Boolean));

    const pending = await base44.entities.ContactRequest.filter({ to_account_id: session.id, status: 'pending' });
    const pendingAccs = await Promise.all(
      pending.map((r) => base44.entities.Account.get(r.from_account_id).catch(() => null))
    );
    setRequests(pending.map((r, i) => ({ ...r, account: pendingAccs[i] })).filter((r) => r.account));
  };

  useEffect(() => { loadData(); }, []);

  const acceptRequest = async (req) => {
    await base44.entities.ContactRequest.update(req.id, { status: 'accepted' });
    await base44.entities.Conversation.create({
      type: 'direct',
      participant_ids: [session.id, req.from_account_id],
      disappearing_timer: 0,
    });
    loadData();
  };

  const declineRequest = async (req) => {
    await base44.entities.ContactRequest.update(req.id, { status: 'declined' });
    loadData();
  };

  const startChat = async (contactId) => {
    const convs = await base44.entities.Conversation.filter({ type: 'direct', participant_ids: session.id });
    const existing = convs.find((c) => c.participant_ids.includes(contactId));
    if (existing) {
      navigate(`/chat/${existing.id}`);
    } else {
      const conv = await base44.entities.Conversation.create({
        type: 'direct',
        participant_ids: [session.id, contactId],
        disappearing_timer: 0,
      });
      navigate(`/chat/${conv.id}`);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <Link to="/home" className="md:hidden text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-heading font-bold text-foreground flex-1">Contacts</h1>
        <button onClick={() => setShowGroup(true)} className="flex items-center gap-1.5 text-sm text-primary px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 transition">
          <Users className="w-4 h-4" /> New Group
        </button>
      </div>
      <div className="p-4 space-y-4 overflow-y-auto flex-1">
        <ContactSearch onContactAdded={loadData} />
        <div className="flex gap-2">
          <button onClick={() => setTab('contacts')} className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${tab === 'contacts' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
            Contacts ({contacts.length})
          </button>
          <button onClick={() => setTab('requests')} className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${tab === 'requests' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
            Requests ({requests.length})
          </button>
          <button onClick={() => setTab('discover')} className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${tab === 'discover' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
            Discover
          </button>
        </div>
        {tab === 'contacts' ? (
          <div className="space-y-1">
            {contacts.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">No contacts yet. Search above to add some!</p>
            ) : (
              contacts.map((c) => (
                <button key={c.id} onClick={() => startChat(c.id)} className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-secondary/50 transition text-left">
                  <Avatar src={c.avatar} name={c.display_name || c.username} size={44} online={c.is_online} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground text-sm truncate">{c.display_name || c.username}</p>
                    <p className="text-xs text-muted-foreground truncate">@{c.username}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        ) : tab === 'requests' ? (
          <div className="space-y-1">
            {requests.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">No pending requests</p>
            ) : (
              requests.map((r) => (
                <div key={r.id} className="flex items-center gap-3 p-2 rounded-xl bg-secondary/30">
                  <Avatar src={r.account.avatar} name={r.account.display_name || r.account.username} size={44} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground text-sm truncate">{r.account.display_name || r.account.username}</p>
                    <p className="text-xs text-muted-foreground truncate">@{r.account.username}</p>
                  </div>
                  <button
                    onClick={() => acceptRequest(r)}
                    aria-label={`Accept contact request from ${r.account.display_name || r.account.username}`}
                    className="w-9 h-9 rounded-full bg-accent/20 text-accent flex items-center justify-center hover:bg-accent/30 transition"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => declineRequest(r)}
                    aria-label={`Decline contact request from ${r.account.display_name || r.account.username}`}
                    className="w-9 h-9 rounded-full bg-destructive/20 text-destructive flex items-center justify-center hover:bg-destructive/30 transition"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        ) : (
          <DiscoverSuggestions />
        )}
      </div>
      <GroupCreateDialog open={showGroup} onClose={() => setShowGroup(false)} onCreated={(conv) => navigate(`/chat/${conv.id}`)} />
    </div>
  );
}