import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { getSession, getSuggestions } from '@/lib/heychatAuth';
import { RefreshCw, UserPlus, MapPin, Clock } from 'lucide-react';
import Avatar from './Avatar';

const COOLDOWN_MS = 12 * 60 * 60 * 1000;

export default function DiscoverSuggestions() {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [sentRequests, setSentRequests] = useState(new Set());
  const [noCountry, setNoCountry] = useState(false);
  const session = getSession();

  useEffect(() => {
    loadSuggestions();
    const interval = setInterval(() => updateCooldown(), 60000);
    return () => clearInterval(interval);
  }, []);

  const loadSuggestions = async () => {
    try {
      const account = await base44.entities.Account.get(session.id);
      if (!account.country) {
        setNoCountry(true);
        setLoading(false);
        return;
      }
      setNoCountry(false);
      const lastRefreshStr = account.last_suggestion_refresh;
      const last = lastRefreshStr ? new Date(lastRefreshStr) : null;

      const cached = localStorage.getItem(`heychat_suggestions_${session.id}`);
      if (cached) {
        try { setSuggestions(JSON.parse(cached)); } catch {}
      }

      if (!last || Date.now() - last.getTime() >= COOLDOWN_MS) {
        await refreshSuggestions(account);
      } else {
        updateCooldown(last);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const updateCooldown = (last) => {
    if (!last) { setCooldownRemaining(0); return; }
    const elapsed = Date.now() - new Date(last).getTime();
    setCooldownRemaining(Math.max(0, COOLDOWN_MS - elapsed));
  };

  const refreshSuggestions = async (account) => {
    setRefreshing(true);
    try {
      const acc = account || await base44.entities.Account.get(session.id);
      if (!acc.country) { setNoCountry(true); return; }
      setNoCountry(false);
      const newSuggestions = await getSuggestions();
      setSuggestions(newSuggestions);
      setCooldownRemaining(COOLDOWN_MS);
      localStorage.setItem(`heychat_suggestions_${session.id}`, JSON.stringify(newSuggestions));
      await base44.entities.Account.update(session.id, { last_suggestion_refresh: new Date().toISOString() });
    } catch (e) {
      console.error(e);
    } finally {
      setRefreshing(false);
    }
  };

  const sendRequest = async (accountId) => {
    try {
      await base44.entities.ContactRequest.create({
        from_account_id: session.id,
        to_account_id: accountId,
        status: 'pending',
      });
      setSentRequests(new Set([...sentRequests, accountId]));
    } catch (e) {
      console.error(e);
    }
  };

  const formatCooldown = (ms) => {
    const hours = Math.floor(ms / (60 * 60 * 1000));
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    return `${hours}h ${minutes}m`;
  };

  const canRefresh = cooldownRemaining === 0;

  if (loading) {
    return <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (noCountry) {
    return (
      <div className="text-center py-12 px-4">
        <MapPin className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
        <p className="text-sm text-muted-foreground">Set your country in Settings to discover people near you.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <MapPin className="w-4 h-4 text-accent" /> People near you
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">5 new suggestions every 12 hours</p>
        </div>
        <button onClick={() => refreshSuggestions()} disabled={!canRefresh || refreshing} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition disabled:opacity-40">
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          {canRefresh ? 'Refresh' : <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatCooldown(cooldownRemaining)}</span>}
        </button>
      </div>

      {suggestions.length === 0 ? (
        <div className="text-center py-8">
          <MapPin className="w-10 h-10 text-muted-foreground mx-auto mb-2 opacity-40" />
          <p className="text-sm text-muted-foreground">No suggestions available right now</p>
          <p className="text-xs text-muted-foreground mt-1">Try refreshing or check back later</p>
        </div>
      ) : (
        <div className="space-y-1">
          {suggestions.map((user) => (
            <div key={user.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-secondary/30 transition">
              <Avatar src={user.avatar} name={user.display_name || user.username} size={44} online={user.is_online} />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground text-sm truncate">{user.display_name || user.username}</p>
                <p className="text-xs text-muted-foreground truncate">@{user.username}</p>
              </div>
              {sentRequests.has(user.id) ? (
                <span className="text-xs text-accent px-3 py-1.5">Request sent</span>
              ) : (
                <button onClick={() => sendRequest(user.id)} className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition">
                  <UserPlus className="w-4 h-4" /> Add
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}