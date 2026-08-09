import { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { getSession, logout, getCurrentAccount } from '@/lib/heychatAuth';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { getMutes } from '@/lib/notifications/mutes';
import { MessageCircle, Users, User, Plus, Search, BellOff } from 'lucide-react';
import Avatar from './Avatar';
import Logo from './Logo';
import GroupCreateDialog from './GroupCreateDialog';

export default function ConversationList() {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState(null);
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const session = getSession();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!session) return;

    // One channel for both tables, not two.
    //
    // Before: Message.subscribe() and Conversation.subscribe() each opened
    // their own channel through the shim, and each fired a full reload of every
    // conversation on ANY change — so one incoming message cost two complete
    // refetches. Realtime enforces RLS, so the events were at least already
    // scoped to this user's rows; the waste was in the response, not the feed.
    const supabase = getSupabaseBrowserClient();
    const channel = supabase.channel(`conversation-list:${session.id}`);

    // Bursts are normal — sending a message writes a row and often touches the
    // conversation moments later. Collapsing them into one reload turns a
    // flurry into a single refetch, and 250ms is below the threshold where a
    // list feels slow to update.
    let timer = null;
    const reload = () => {
      clearTimeout(timer);
      timer = setTimeout(() => loadConversations(), 250);
    };

    (async () => {
      const acc = await getCurrentAccount();
      setAccount(acc);
      await loadConversations();

      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, reload)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, reload)
        .subscribe();
    })();

    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, []);

  /**
   * Four queries, regardless of how many conversations there are: the
   * conversations, the other participants, the last message of each, and the
   * mutes. It used to be 1 + 2N.
   */
  const loadConversations = async () => {
    try {
      const supabase = getSupabaseBrowserClient();

      const convs = await base44.entities.Conversation.filter(
        { participant_ids: session.id }, '-updated_date', 50
      );

      if (convs.length === 0) {
        setConversations([]);
        return;
      }

      const convIds = convs.map((c) => c.id);

      // Every "other participant" across every direct conversation, in one go.
      const otherIds = [
        ...new Set(
          convs
            .filter((c) => c.type !== 'group')
            .map((c) => c.participant_ids.find((id) => id !== session.id))
            .filter(Boolean)
        ),
      ];

      const [accountsRes, lastMsgRes, mutes] = await Promise.all([
        otherIds.length
          ? supabase.from('accounts').select('id, username, display_name, avatar, is_online').in('id', otherIds)
          : Promise.resolve({ data: [] }),
        // `distinct on` in one round trip — see 0011_conversation_list.sql.
        supabase.rpc('last_messages_for_conversations', { conv_ids: convIds }),
        getMutes(convIds),
      ]);

      const accountsById = new Map((accountsRes.data || []).map((a) => [a.id, a]));
      const lastByConv = new Map((lastMsgRes.data || []).map((m) => [m.conversation_id, m]));

      const enriched = convs.map((conv) => {
        const lastMsg = lastByConv.get(conv.id) || null;
        if (conv.type === 'group') {
          return {
            ...conv,
            displayName: conv.name || 'Group',
            displayAvatar: conv.cover_image,
            online: false,
            lastMsg,
            muted: mutes.has(conv.id),
          };
        }
        const other = accountsById.get(conv.participant_ids.find((id) => id !== session.id));
        return {
          ...conv,
          displayName: other?.display_name || other?.username || 'Conversation',
          displayAvatar: other?.avatar || '',
          online: Boolean(other?.is_online),
          lastMsg,
          muted: mutes.has(conv.id),
        };
      });

      // Sorted by last message, not by conversations.updated_date.
      //
      // The query above orders by updated_date because that is what the shim
      // can express, but nothing bumps a conversation row when a message
      // arrives — so on that ordering a brand-new message did not move its
      // conversation to the top, which is the one thing this list is for.
      enriched.sort((a, b) => {
        const at = new Date(a.lastMsg?.created_date || a.updated_date).getTime();
        const bt = new Date(b.lastMsg?.created_date || b.updated_date).getTime();
        return bt - at;
      });

      setConversations(enriched);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const getLastMessagePreview = (msg) => {
    if (!msg) return 'No messages yet';
    switch (msg.message_type) {
      case 'image': return '📷 Photo';
      case 'video': return '🎥 Video';
      case 'voice': return '🎤 Voice message';
      case 'file': return '📎 File';
      default: return msg.content || '';
    }
  };

  const isActive = (id) => location.pathname === `/chat/${id}`;

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b-2 border-foreground">
        <div className="flex items-center justify-between mb-3">
          <Link to="/home" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl gradient-bg flex items-center justify-center shadow-pop-sm">
              <Logo className="w-5 h-5" />
            </div>
            <span className="text-2xl font-display font-extrabold text-foreground">HeyChat</span>
          </Link>
          <div className="flex items-center gap-1">
            <Link to="/contacts" className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition">
              <User className="w-5 h-5" />
            </Link>
            <button onClick={() => setShowGroupDialog(true)} className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition">
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </div>
        <Link to="/contacts" className="flex items-center gap-2 bg-secondary border-2 border-foreground rounded-xl px-3 py-2.5">
          <Search className="w-4 h-4 text-foreground" />
          <span className="text-sm font-medium text-muted-foreground">Search contacts</span>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="text-center py-12 px-4">
            <MessageCircle className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-sm text-muted-foreground">No conversations yet</p>
            <Link to="/contacts" className="text-sm text-primary mt-2 inline-block">Add contacts to start</Link>
          </div>
        ) : (
          conversations.map((conv) => (
            <Link
              key={conv.id}
              to={`/chat/${conv.id}`}
              className={`flex items-center gap-3 px-4 py-3 transition border-b border-border ${
                isActive(conv.id) ? 'bg-accent' : 'hover:bg-secondary'
              }`}
            >
              <Avatar src={conv.displayAvatar} name={conv.displayName} size={48} online={conv.online} isGroup={conv.type === 'group'} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="font-display font-bold text-foreground text-[15px] truncate">
                    {conv.type === 'group' && <Users className="w-3.5 h-3.5 inline mr-1 text-muted-foreground" />}
                    {conv.displayName}
                  </p>
                  {conv.lastMsg && (
                    <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                      {new Date(conv.lastMsg.created_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {getLastMessagePreview(conv.lastMsg)}
                </p>
              </div>
              {conv.muted && <BellOff className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
              {conv.disappearing_timer > 0 && <span className="text-sm">🔥</span>}
            </Link>
          ))
        )}
      </div>

      <GroupCreateDialog open={showGroupDialog} onClose={() => setShowGroupDialog(false)} onCreated={(conv) => navigate(`/chat/${conv.id}`)} />
    </div>
  );
}