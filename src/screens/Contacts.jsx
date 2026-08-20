import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSession } from '@/lib/heychatAuth';
import { Users, Check, X, UsersRound, UserMinus, Clock } from 'lucide-react';
import Avatar from '@/components/heychat/Avatar';
import ContactSearch from '@/components/heychat/ContactSearch';
import GroupCreateDialog from '@/components/heychat/GroupCreateDialog';
import DiscoverSuggestions from '@/components/heychat/DiscoverSuggestions';
import { myGroupInvites, respondToInvite } from '@/lib/groups';
import { removeContact, getOrCreateDirectConversation } from '@/lib/conversations';
import { getAccountsById } from '@/lib/accounts';
import {
  getContactIds,
  getReceivedRequests,
  getSentRequests,
  setRequestStatus,
  withdrawRequest,
} from '@/lib/contacts';
import { refreshPending } from '@/lib/pending';

export default function Contacts() {
  const [tab, setTab] = useState('contacts');
  const [contacts, setContacts] = useState([]);
  const [requests, setRequests] = useState([]);
  const [groupInvites, setGroupInvites] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [showGroup, setShowGroup] = useState(false);
  const session = getSession();
  const navigate = useNavigate();

  const loadData = async () => {
    // Five reads, not 1 + 3N. The shim had no way to fetch several accounts at
    // once, so every one of these lists looped `Account.get` and paid a request
    // per person — a screen with twenty contacts made twenty-three round trips.
    const [contactIds, pending, outgoing] = await Promise.all([
      getContactIds(session.id),
      getReceivedRequests(session.id, 'pending'),
      getSentRequests(session.id, 'pending'),
    ]);

    const people = await getAccountsById([
      ...contactIds,
      ...pending.map((r) => r.from_account_id),
      ...outgoing.map((r) => r.to_account_id),
    ]);

    setContacts([...contactIds].map((id) => people.get(id)).filter(Boolean));

    setRequests(
      pending
        .map((r) => ({ ...r, account: people.get(r.from_account_id) }))
        .filter((r) => r.account)
    );

    // Requests you have sent and nobody has answered yet. RLS already limits
    // contact_requests to rows you are a party to, so this is the same read as
    // the one above with the direction reversed.
    setSentRequests(
      outgoing
        .map((r) => ({ ...r, account: people.get(r.to_account_id) }))
        .filter((r) => r.account)
    );

    // Group invitations (0019). Through an RPC because the invitee is not a
    // member of the conversation yet, so conversations RLS will not show them
    // its name. Degrades to none rather than throwing while 0019 is unapplied.
    setGroupInvites(await myGroupInvites().catch(() => []));

    // Keep the nav badge in step with this screen. Accepting or declining here
    // is the main way the count goes down, and without this it would keep
    // advertising a request you just dealt with.
    refreshPending(session.id);
  };

  useEffect(() => { loadData(); }, []);

  const acceptRequest = async (req) => {
    await setRequestStatus(req.id, 'accepted');
    // GET-OR-CREATE, NOT CREATE. This used to insert unconditionally, so
    // accept -> unfriend -> ask again -> accept left TWO direct conversations
    // between the same two people. Both showed in the list with the same name
    // and each held half the history, which reads as messages appearing twice.
    // Unfriending deliberately does not delete the conversation, so the old one
    // is always still there to be found.
    await getOrCreateDirectConversation(session.id, req.from_account_id);
    loadData();
  };

  const declineRequest = async (req) => {
    await setRequestStatus(req.id, 'declined');
    loadData();
  };

  /**
   * Withdrawing DELETES the row rather than marking it cancelled.
   *
   * (from_account_id, to_account_id) is unique, so a row left behind in any
   * status is a row that blocks you from ever asking that person again — and
   * the insert would fail somewhere the user cannot see it.
   */
  const withdrawRequest = async (req) => {
    try {
      await withdrawRequest(req.id);
    } catch (e) {
      console.error(e);
    }
    loadData();
  };

  /**
   * Accepting is what puts you in the group — the invite alone does not, which
   * is the whole point of 0019. Declining is recorded rather than dropped, so
   * an admin re-inviting is a deliberate act and not a silent retry.
   */
  const answerInvite = async (invite, accept) => {
    try {
      await respondToInvite(invite.id, accept);
      if (accept) {
        navigate(`/chat/${invite.conversation_id}`);
        return;
      }
    } catch (e) {
      console.error(e);
    }
    loadData();
  };

  const startChat = async (contactId) => {
    const conv = await getOrCreateDirectConversation(session.id, contactId);
    navigate(`/chat/${conv.id}`);
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="border-b border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-2xl mx-auto w-full">
          <h1 className="text-2xl font-display font-extrabold text-foreground flex-1">Contacts</h1>
          <button onClick={() => setShowGroup(true)} className="flex items-center gap-1.5 text-sm text-primary px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 transition">
            <Users className="w-4 h-4" /> New Group
          </button>
        </div>
      </div>
      <div className="p-4 space-y-4 overflow-y-auto flex-1 max-w-2xl mx-auto w-full">
        <ContactSearch onContactAdded={loadData} />
        <div className="flex gap-2">
          <button onClick={() => setTab('contacts')} className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${tab === 'contacts' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
            Contacts ({contacts.length})
          </button>
          <button onClick={() => setTab('requests')} className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${tab === 'requests' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
            Requests ({requests.length + groupInvites.length})
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
              // A div wrapping two buttons, not one button containing another —
              // nested interactive elements are invalid and the inner one stops
              // being reachable by keyboard.
              contacts.map((c) => (
                <div key={c.id} className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-secondary/50 transition">
                  <button
                    onClick={() => startChat(c.id)}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                  >
                    <Avatar src={c.avatar} name={c.display_name || c.username} size={44} online={c.is_online} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground text-sm truncate">{c.display_name || c.username}</p>
                      <p className="text-xs text-muted-foreground truncate">@{c.username}</p>
                    </div>
                  </button>
                  <button
                    onClick={() => setConfirmRemove(c)}
                    aria-label={`Remove ${c.display_name || c.username} from contacts`}
                    className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-secondary transition"
                  >
                    <UserMinus className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        ) : tab === 'requests' ? (
          <div className="space-y-1">
            {/* Group invitations first: being put in a room with people is a
                bigger decision than adding one contact. */}
            {groupInvites.map((g) => (
              <div key={g.id} className="flex items-center gap-3 p-2 rounded-xl bg-secondary/30">
                <Avatar src={g.cover_image} name={g.group_name} size={44} isGroup />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground text-sm truncate flex items-center gap-1.5">
                    <UsersRound className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                    {g.group_name}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {g.inviter_name} invited you
                  </p>
                </div>
                <button
                  onClick={() => answerInvite(g, true)}
                  aria-label={`Join ${g.group_name}`}
                  className="w-9 h-9 rounded-full bg-accent text-accent-foreground border-2 border-foreground shadow-pop-sm flex items-center justify-center hover:-translate-y-0.5 transition"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  onClick={() => answerInvite(g, false)}
                  aria-label={`Decline the invitation to ${g.group_name}`}
                  className="w-9 h-9 rounded-full bg-card text-foreground border-2 border-foreground shadow-pop-sm flex items-center justify-center hover:-translate-y-0.5 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}

            {requests.length === 0 && groupInvites.length === 0 ? (
              sentRequests.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">No pending requests</p>
              ) : null
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
                    className="w-9 h-9 rounded-full bg-accent text-accent-foreground border-2 border-foreground shadow-pop-sm flex items-center justify-center hover:-translate-y-0.5 transition"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => declineRequest(r)}
                    aria-label={`Decline contact request from ${r.account.display_name || r.account.username}`}
                    className="w-9 h-9 rounded-full bg-card text-foreground border-2 border-foreground shadow-pop-sm flex items-center justify-center hover:-translate-y-0.5 transition"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}

            {/* Requests YOU sent. Without this the sender had no record of them
                anywhere — the only trace was a tick in component state, so
                signing out made every request you had sent look like it had
                never happened, or been cancelled. */}
            {sentRequests.length > 0 && (
              <div className="pt-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 pb-1">
                  Sent · waiting for a reply
                </p>
                {sentRequests.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 p-2 rounded-xl">
                    <Avatar src={r.account.avatar} name={r.account.display_name || r.account.username} size={44} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground text-sm truncate">{r.account.display_name || r.account.username}</p>
                      <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                        <Clock className="w-3 h-3 shrink-0" /> @{r.account.username}
                      </p>
                    </div>
                    <button
                      onClick={() => withdrawRequest(r)}
                      aria-label={`Withdraw the contact request to ${r.account.display_name || r.account.username}`}
                      className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-destructive transition"
                    >
                      Withdraw
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <DiscoverSuggestions />
        )}
      </div>
      {confirmRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-foreground/40">
          <div className="w-full max-w-sm bg-card border-2 border-foreground rounded-2xl shadow-pop p-5">
            <h2 className="text-lg font-display font-extrabold text-foreground">
              Remove {confirmRemove.display_name || confirmRemove.username}?
            </h2>
            {/* Says what it does NOT do, because "remove" invites people to
                assume it blocks and deletes, and it does neither. */}
            <p className="text-sm text-muted-foreground mt-2">
              They come off your contacts list. Your conversation and its
              messages stay where they are, and they are not blocked — they can
              send you a new contact request.
            </p>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setConfirmRemove(null)}
                className="flex-1 py-2.5 rounded-xl border-2 border-foreground bg-card font-bold text-sm"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const who = confirmRemove;
                  setConfirmRemove(null);
                  try {
                    await removeContact(session.id, who.id);
                  } catch (e) {
                    console.error(e);
                  }
                  loadData();
                }}
                className="flex-1 py-2.5 rounded-xl border-2 border-foreground bg-destructive text-destructive-foreground font-bold text-sm"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      <GroupCreateDialog open={showGroup} onClose={() => setShowGroup(false)} onCreated={(conv) => navigate(`/chat/${conv.id}`)} />
    </div>
  );
}