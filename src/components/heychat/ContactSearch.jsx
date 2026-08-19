import { useEffect, useState } from 'react';
import { listAccountsPage } from '@/lib/accounts';
import { getSentRequests, sendContactRequest } from '@/lib/contacts';
import { getSession } from '@/lib/heychatAuth';
import { Search, UserPlus, Check, Clock } from 'lucide-react';
import Avatar from './Avatar';

/**
 * Search for someone, and ask to be their contact.
 *
 * THE STATE OF A REQUEST LIVES IN THE DATABASE, NOT IN THIS COMPONENT. It used
 * to be a `sentTo` object in React state, which meant the "Sent" tick survived
 * exactly as long as the page did: sign out, sign back in, and every request
 * you had ever sent looked unsent. Worse, clicking Add again did nothing at
 * all — `sendRequest` found the existing row and returned silently — so the
 * button appeared broken rather than already-pressed.
 *
 * `contact_requests` has a unique constraint on (from, to), so there is at most
 * one row per pair for all time. That is what makes reading the real status
 * cheap, and it is also why a declined request has to be REUSED rather than
 * re-inserted.
 */
export default function ContactSearch({ onContactAdded }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  // to_account_id -> 'pending' | 'accepted' | 'declined'
  const [outgoing, setOutgoing] = useState({});
  const session = getSession();

  const loadOutgoing = async () => {
    try {
      const rows = await getSentRequests(session.id);
      setOutgoing(Object.fromEntries(rows.map((r) => [r.to_account_id, r.status])));
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => { loadOutgoing(); }, []);

  const handleSearch = async (val) => {
    setQuery(val);
    setError('');
    if (!val.trim() || val.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const accounts = await listAccountsPage(20);
      const filtered = accounts.filter(
        (a) =>
          a.id !== session.id &&
          a.username.toLowerCase().includes(val.toLowerCase())
      );
      setResults(filtered);
    } catch (e) {
      console.error(e);
    } finally {
      setSearching(false);
    }
  };

  const sendRequest = async (account) => {
    setBusyId(account.id);
    setError('');
    try {
      // Reuse-or-insert, and the "already contacts" case, both live in
      // sendContactRequest now — they are constraints of the table rather than
      // of this screen, and two other callers need the same rules.
      const result = await sendContactRequest({
        fromId: session.id,
        toId: account.id,
        toUsername: account.username,
      });

      setOutgoing((o) => ({ ...o, [account.id]: result === 'already-contacts' ? 'accepted' : 'pending' }));
      if (result === 'already-contacts') return;
      if (onContactAdded) onContactAdded();
    } catch (e) {
      console.error(e);
      setError('That request could not be sent. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 bg-secondary rounded-xl px-3 py-2.5">
        <Search className="w-4 h-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search by username..."
          className="flex-1 bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground"
        />
        {searching && <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />}
      </div>
      {error && <p className="text-xs text-destructive mt-2">{error}</p>}
      {results.length > 0 && (
        <div className="mt-2 space-y-1">
          {results.map((account) => {
            const status = outgoing[account.id];
            const name = account.display_name || account.username;
            return (
              <div key={account.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-secondary/50 transition">
                <Avatar src={account.avatar} name={name} size={40} online={account.is_online} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground text-sm truncate">{name}</p>
                  <p className="text-xs text-muted-foreground truncate">@{account.username}</p>
                </div>
                {status === 'accepted' ? (
                  <div className="flex items-center gap-1 text-muted-foreground text-xs font-medium px-3 py-1.5">
                    <Check className="w-3.5 h-3.5" /> Contact
                  </div>
                ) : status === 'pending' ? (
                  <div
                    className="flex items-center gap-1 text-accent text-xs font-medium px-3 py-1.5"
                    aria-label={`Request already sent to ${name}`}
                  >
                    <Clock className="w-3.5 h-3.5" /> Requested
                  </div>
                ) : (
                  <button
                    onClick={() => sendRequest(account)}
                    disabled={busyId === account.id}
                    aria-label={`Send a contact request to ${name}`}
                    className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 transition"
                  >
                    <UserPlus className="w-3.5 h-3.5" /> {busyId === account.id ? 'Sending…' : 'Add'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {query.length >= 2 && results.length === 0 && !searching && (
        <p className="text-center text-sm text-muted-foreground py-6">No users found for "{query}"</p>
      )}
    </div>
  );
}
