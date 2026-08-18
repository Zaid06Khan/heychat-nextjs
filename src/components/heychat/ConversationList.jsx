import { useEffect, useState, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { getSession, logout, getCurrentAccount } from '@/lib/heychatAuth';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { getMutes } from '@/lib/notifications/mutes';
import { getConversationHides } from '@/lib/conversations';
import { playMessageSound } from '@/lib/sound';
import { setUnreadTotal } from '@/lib/unread';
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
  // Muted conversation ids, readable from inside the realtime callback without
  // making `conversations` a dependency of the effect that opens the channel.
  const mutedRef = useRef(new Set());

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

    // Bursts are normal — sending a message writes a row and often touches the
    // conversation moments later. Collapsing them into one reload turns a
    // flurry into a single refetch, and 250ms is below the threshold where a
    // list feels slow to update.
    let timer = null;
    const reload = () => {
      clearTimeout(timer);
      timer = setTimeout(() => loadConversations(), 250);
    };

    // AUTH BEFORE SUBSCRIBE, and this order is load-bearing.
    //
    // Realtime evaluates RLS per subscriber to decide what it may send. It can
    // only do that once the socket has been given this user's JWT — and
    // supabase-js applies that asynchronously. This channel used to be created
    // and subscribed synchronously at the top of the effect, which meant it
    // registered before the token existed, the RLS check ran unauthorised, and
    // EVERY payload arrived as `{ new: {}, errors: ['Error 401: Unauthorized'] }`.
    //
    // It went unnoticed for months because the handler was `reload`, which
    // ignores its argument — the list refetched and looked correct. It only
    // surfaced when something needed to read `payload.new.sender_id`. ChatView's
    // channels were unaffected by luck rather than design: they open after two
    // awaits, by which point the token is set.
    //
    // The handlers are still registered synchronously *relative to creating the
    // channel*, which is what the previous fix here was about — the await
    // happens before the channel exists, not between creating and configuring it.
    let channel = null;
    let cancelled = false;

    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (cancelled) return;

      const token = sessionData?.session?.access_token;
      if (token) {
        try {
          await supabase.realtime.setAuth(token);
        } catch {
          // An older supabase-js applies the token itself on auth state change.
          // Failing here means we fall back to that, not that nothing works.
        }
      }
      if (cancelled) return;

      channel = supabase.channel(
        `conversation-list:${session.id}:${Math.random().toString(36).slice(2)}`
      );

      /**
       * The arrival sound.
       *
       * Lives here rather than in ChatView because this component is mounted for
       * the whole signed-in app (AppLayout's aside), so one handler covers every
       * conversation — and because putting it in both would ring twice on
       * desktop, where both are on screen at once.
       *
       * ONLY WHEN THE TAB IS VISIBLE. If it is hidden, a push notification is
       * the thing that should make a noise, and the OS plays that. The overlap
       * that remains is narrow and deliberate: with push enabled and the app
       * focused on some *other* conversation, the service worker still shows a
       * notification (it only suppresses for the conversation you are actually
       * looking at), so both can sound. The Settings toggle is the escape hatch.
       */
      const onMessageEvent = (payload) => {
        reload();
        if (payload.eventType !== 'INSERT') return;
        const row = payload.new;
        // No sender_id means the payload came back empty — the bug above. Better
        // to stay silent than to ring for the person's own message.
        if (!row?.sender_id || row.sender_id === session.id) return;
        if (document.visibilityState !== 'visible') return;
        // A muted conversation is silent, which is what muting means. Realtime is
        // RLS-scoped, so anything arriving here is already something this account
        // is entitled to see.
        if (mutedRef.current.has(row.conversation_id)) return;
        playMessageSound();
      };

      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, onMessageEvent)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, reload)
        .subscribe();

      const acc = await getCurrentAccount();
      if (cancelled) return;
      setAccount(acc);
      await loadConversations();
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (channel) supabase.removeChannel(channel);
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
        setUnreadTotal(0);
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

      const [accountsRes, lastMsgRes, unreadRes, mutes, hides] = await Promise.all([
        otherIds.length
          ? supabase.from('accounts').select('id, username, display_name, avatar, is_online').in('id', otherIds)
          : Promise.resolve({ data: [] }),
        // `distinct on` in one round trip — see 0011_conversation_list.sql.
        supabase.rpc('last_messages_for_conversations', { conv_ids: convIds }),
        // Counted by Postgres — see 0014_unread_counts.sql. Counting these in
        // the browser would mean fetching every message of every conversation.
        supabase.rpc('unread_counts', { conv_ids: convIds }),
        getMutes(convIds),
        // "Delete chat" (0023). Fetched with the rest rather than filtered in
        // the conversations query, because that query goes through the shim and
        // cannot express a NOT EXISTS against another table.
        getConversationHides(),
      ]);

      const accountsById = new Map((accountsRes.data || []).map((a) => [a.id, a]));
      const lastByConv = new Map((lastMsgRes.data || []).map((m) => [m.conversation_id, m]));
      const unreadByConv = new Map((unreadRes.data || []).map((u) => [u.conversation_id, Number(u.unread)]));

      const enriched = convs.map((conv) => {
        const lastMsg = lastByConv.get(conv.id) || null;
        const unread = unreadByConv.get(conv.id) || 0;
        if (conv.type === 'group') {
          return {
            ...conv,
            displayName: conv.name || 'Group',
            displayAvatar: conv.cover_image,
            online: false,
            lastMsg,
            unread,
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
          unread,
          muted: mutes.has(conv.id),
        };
      });

      // A deleted chat stays gone until something arrives after the moment it
      // was deleted — at which point it comes back carrying only that. The RPCs
      // already exclude older messages, so a hidden conversation with nothing
      // new has no last message and drops out here.
      const visible = enriched.filter((conv) => {
        const hiddenAt = hides.get(conv.id);
        if (!hiddenAt) return true;
        return Boolean(conv.lastMsg) && new Date(conv.lastMsg.created_date) > hiddenAt;
      });

      // Sorted by last message, not by conversations.updated_date.
      //
      // The query above orders by updated_date because that is what the shim
      // can express, but nothing bumps a conversation row when a message
      // arrives — so on that ordering a brand-new message did not move its
      // conversation to the top, which is the one thing this list is for.
      visible.sort((a, b) => {
        const at = new Date(a.lastMsg?.created_date || a.updated_date).getTime();
        const bt = new Date(b.lastMsg?.created_date || b.updated_date).getTime();
        return bt - at;
      });

      setConversations(visible);
      mutedRef.current = new Set(visible.filter((c) => c.muted).map((c) => c.id));

      // Publishes to the nav badge. Muted conversations still count — muting
      // silences the notification, it does not mark anything as read.
      setUnreadTotal(visible.reduce((sum, c) => sum + c.unread, 0));
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
            <Logo className="w-9 h-9" />
            <span className="text-2xl font-display font-extrabold text-foreground">Calamus3</span>
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
                    <span className={`text-[10px] shrink-0 ml-2 ${
                      conv.unread > 0 ? 'text-primary font-bold' : 'text-muted-foreground'
                    }`}>
                      {new Date(conv.lastMsg.created_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
                {/* Unread rows carry the preview in full-strength ink and bold.
                    Colour alone would not do it — the muted/normal difference is
                    a contrast step some people cannot see, so weight carries it
                    too, and the count badge states it outright. */}
                <p className={`text-xs truncate mt-0.5 ${
                  conv.unread > 0 ? 'text-foreground font-semibold' : 'text-muted-foreground'
                }`}>
                  {getLastMessagePreview(conv.lastMsg)}
                </p>
              </div>
              {conv.unread > 0 && (
                <span
                  aria-label={`${conv.unread} unread`}
                  className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-primary-foreground border-2 border-foreground text-[10px] font-extrabold flex items-center justify-center"
                >
                  {conv.unread > 99 ? '99+' : conv.unread}
                </span>
              )}
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