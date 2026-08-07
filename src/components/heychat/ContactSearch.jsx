import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { getSession } from '@/lib/heychatAuth';
import { Search, UserPlus, Check, X } from 'lucide-react';
import Avatar from './Avatar';

export default function ContactSearch({ onContactAdded }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [sentTo, setSentTo] = useState({});
  const session = getSession();

  const handleSearch = async (val) => {
    setQuery(val);
    if (!val.trim() || val.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const accounts = await base44.entities.Account.filter({}, null, 20);
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
    try {
      const existing = await base44.entities.ContactRequest.filter({
        from_account_id: session.id,
        to_account_id: account.id,
      });
      if (existing.length > 0) return;

      await base44.entities.ContactRequest.create({
        from_account_id: session.id,
        to_account_id: account.id,
        to_username: account.username,
        status: 'pending',
      });
      setSentTo((s) => ({ ...s, [account.id]: true }));
      if (onContactAdded) onContactAdded();
    } catch (e) {
      console.error(e);
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
      {results.length > 0 && (
        <div className="mt-2 space-y-1">
          {results.map((account) => (
            <div key={account.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-secondary/50 transition">
              <Avatar src={account.avatar} name={account.display_name || account.username} size={40} online={account.is_online} />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground text-sm truncate">{account.display_name || account.username}</p>
                <p className="text-xs text-muted-foreground truncate">@{account.username}</p>
              </div>
              {sentTo[account.id] ? (
                <div className="flex items-center gap-1 text-accent text-xs font-medium px-3 py-1.5">
                  <Check className="w-3.5 h-3.5" /> Sent
                </div>
              ) : (
                <button
                  onClick={() => sendRequest(account)}
                  className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition"
                >
                  <UserPlus className="w-3.5 h-3.5" /> Add
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {query.length >= 2 && results.length === 0 && !searching && (
        <p className="text-center text-sm text-muted-foreground py-6">No users found for "{query}"</p>
      )}
    </div>
  );
}