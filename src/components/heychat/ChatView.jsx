import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getAccount, getAccountsById } from '@/lib/accounts';
import { getConversation, updateDisappearingTimer } from '@/lib/conversations';
import { getRecentMessages } from '@/lib/messages/read';
import { getSession, getCurrentAccount } from '@/lib/heychatAuth';
import { sendMessage } from '@/lib/messages/send';
import { getMute, muteConversation, unmuteConversation, MUTE_OPTIONS } from '@/lib/notifications/mutes';
import {
  getReactions,
  toggleReaction,
  editMessage,
  deleteMessageForEveryone,
  hideMessageForMe,
  getHiddenMessageIds,
  getMessagesByIds,
} from '@/lib/messages/interactions';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { hideConversation, getConversationHides } from '@/lib/conversations';
import { playSentSound } from '@/lib/sound';
import { startCall, watchForCalls, getCallState } from '@/lib/calls/controller';
import { createTypingChannel } from '@/lib/messages/typing';
import { markRead } from '@/lib/unread';
import { ArrowLeft, Shield, Flame, Flag, Bell, BellOff, AlertCircle, Trash2, Phone, Video } from 'lucide-react';
import Avatar from './Avatar';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import ReportDialog from './ReportDialog';
import GroupInfoDialog from './GroupInfoDialog';

const TIMERS = [
  { label: 'Off', value: 0 },
  { label: '30 seconds', value: 30 },
  { label: '1 minute', value: 60 },
  { label: '1 hour', value: 3600 },
  { label: '24 hours', value: 86400 },
  { label: '7 days', value: 604800 },
];

export default function ChatView() {
  const { conversationId } = useParams();
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showTimer, setShowTimer] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [mute, setMute] = useState(null);
  const [showMute, setShowMute] = useState(false);
  const [reactions, setReactions] = useState(new Map());
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [typingNames, setTypingNames] = useState([]);
  const [sendError, setSendError] = useState(null);
  const [confirmDeleteChat, setConfirmDeleteChat] = useState(false);
  // Originals quoted by a reply but not themselves in the loaded 200.
  const [quotedById, setQuotedById] = useState(new Map());
  const [highlightId, setHighlightId] = useState(null);
  // The ids currently on screen, readable from inside a subscription callback
  // without making `messages` a dependency of the effect that opens it.
  const messageIdsRef = useRef(new Set());
  const typingRef = useRef(null);
  const [otherUser, setOtherUser] = useState(null);
  const [members, setMembers] = useState([]);
  const messagesEndRef = useRef(null);
  const session = getSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!conversationId) return;

    /**
     * One channel for messages and reactions, debounced.
     *
     * Before: `Message.subscribe()` opened a channel through the shim carrying
     * EVERY message row in the database and threw away the ones for other
     * conversations in the browser, and a second channel carried reactions.
     * Two sockets, and one of them a firehose.
     *
     * Now the messages half is filtered server-side by `conversation_id`, so
     * the rows for other people's chats never leave Postgres. Reactions cannot
     * be filtered that way — `message_reactions` has no conversation_id — so
     * every event the caller is entitled to see (Realtime enforces RLS) is
     * checked against the message ids currently on screen and anything else is
     * dropped. Reading those ids from a ref keeps `messages` out of this
     * effect's dependencies, which would otherwise tear the channel down and
     * rebuild it on every new message.
     *
     * The debounce matters most on the reaction path: reacting fires an event
     * per row, and a burst used to mean a `getReactions` per row.
     */
    const supabase = getSupabaseBrowserClient();
    let channel = null;
    let cancelled = false;
    let timer = null;
    let wantMessages = false;
    let wantReactions = false;

    const flush = () => {
      timer = null;
      if (cancelled) return;
      if (wantMessages) {
        wantMessages = false;
        loadMessages();
      }
      if (wantReactions) {
        wantReactions = false;
        const ids = [...messageIdsRef.current];
        if (ids.length) getReactions(ids).then(setReactions);
      }
    };

    const schedule = () => {
      if (timer) return;
      timer = setTimeout(flush, 120);
    };

    (async () => {
      await loadConversation();
      await loadMessages();
      setMute(await getMute(conversationId));

      // Realtime evaluates RLS per subscriber to decide what it may send, and
      // it needs this session's token to do that. Subscribe first and every
      // payload comes back empty with a 401 — silently, if the handler ignores
      // its argument. The await happens before the channel exists, not between
      // creating and subscribing it.
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (token) {
        try { await supabase.realtime.setAuth(token); } catch { /* older client */ }
      }
      if (cancelled) return;

      channel = supabase
        .channel(`chat:${conversationId}:${Math.random().toString(36).slice(2)}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'messages',
            filter: `conversation_id=eq.${conversationId}`,
          },
          () => { wantMessages = true; schedule(); }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'message_reactions' },
          (payload) => {
            const id = payload.new?.message_id || payload.old?.message_id;
            if (!id || !messageIdsRef.current.has(id)) return;
            wantReactions = true;
            schedule();
          }
        )
        .subscribe();

      const me = await getCurrentAccount();
      if (cancelled) return;
      typingRef.current = createTypingChannel({
        conversationId,
        accountId: session.id,
        displayName: me?.display_name || me?.username || 'Someone',
        onChange: setTypingNames,
      });
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (channel) supabase.removeChannel(channel);
      typingRef.current?.close();
      typingRef.current = null;
      setTypingNames([]);
    };
  }, [conversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /**
   * Listen for ringing in this conversation.
   *
   * Scoped to the conversation on screen for now. Listening across every
   * conversation would mean holding one channel open per conversation
   * permanently, which is a real cost — so a call currently reaches you if you
   * are in that chat. See FOLLOWUPS.
   */
  useEffect(() => {
    if (!conversationId || !session?.id) return undefined;
    if (conversation && conversation.type !== 'direct') return undefined;

    let dispose = () => {};
    let cancelled = false;
    (async () => {
      const stop = await watchForCalls({
        conversationId,
        meId: session.id,
        peerName: otherUser?.display_name || otherUser?.username || 'Someone',
      });
      if (cancelled) stop();
      else dispose = stop;
    })();

    return () => { cancelled = true; dispose(); };
  }, [conversationId, session?.id, otherUser?.id, conversation?.type]);

  const loadConversation = async () => {
    try {
      const conv = await getConversation(conversationId);
      setConversation(conv);
      if (conv.type === 'direct') {
        const otherId = conv.participant_ids.find((id) => id !== session.id);
        if (otherId) {
          const acc = await getAccount(otherId);
          setOtherUser(acc);
        }
      } else {
        // One read for the whole member list, not one per member.
        const people = await getAccountsById(conv.participant_ids);
        setMembers(conv.participant_ids.map((id) => people.get(id)).filter(Boolean));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadMessages = async () => {
    try {
      // NEWEST 200, then flipped back into reading order.
      //
      // This used to sort ascending with the same limit, which takes the OLDEST
      // 200 — so any conversation past 200 messages showed the first 200 ever
      // sent and nothing since, and new messages never appeared at all. Nobody
      // hit it because no test conversation had ever been that long; a 220-
      // message fixture built to test reply quotes is what surfaced it.
      const newest = await getRecentMessages(conversationId, 200);
      const msgs = [...newest].reverse();
      // Still filtered here, but no longer deleted here. The sweep runs every
      // five minutes (0010), so a row can outlive its expiry by a few minutes —
      // hiding it locally keeps "disappearing" honest on screen in the gap.
      const now = new Date();
      let unexpired = msgs.filter((m) => !m.expiry_at || new Date(m.expiry_at) > now);

      // "Delete chat" (0023) is a moment, not a flag: anything from before you
      // deleted the chat stays deleted, and anything sent since is why the
      // conversation is back on your list at all. Same rule the sidebar preview
      // and the unread count apply server-side.
      const hiddenAt = (await getConversationHides()).get(conversationId);
      if (hiddenAt) unexpired = unexpired.filter((m) => new Date(m.created_date) > hiddenAt);

      // "Delete for me" (0016). Filtered here rather than in the query because
      // the messages come through the shim, which has no way to express a
      // NOT EXISTS against another table. The sidebar preview and the unread
      // count apply the same rule server-side, so the three agree.
      const hidden = await getHiddenMessageIds(unexpired.map((m) => m.id));
      const active = hidden.size
        ? unexpired.filter((m) => !hidden.has(m.id))
        : unexpired;
      setMessages(active);
      messageIdsRef.current = new Set(active.map((m) => m.id));

      // Originals quoted by a reply that are not themselves in this batch —
      // older than the 200 loaded. Without this the bubble claims the original
      // is unavailable when it is merely further up.
      const loaded = messageIdsRef.current;
      const missingQuotes = [
        ...new Set(
          active.map((m) => m.reply_to_id).filter((id) => id && !loaded.has(id))
        ),
      ];
      setQuotedById(await getMessagesByIds(missingQuotes));

      setReactions(await getReactions(active.map((m) => m.id)));

      await markRead(
        active
          .filter((m) => m.sender_id !== session.id && !(m.read_by || []).includes(session.id))
          .map((m) => m.id)
      );
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async (data) => {
    if (!conversation) return;

    // Editing reuses the composer rather than an inline field, so a submit
    // while `editing` is set means "save the edit", not "send a new message".
    if (editing) {
      const target = editing;
      setEditing(null);
      try {
        await editMessage(target.id, data.content || '');
        await loadMessages();
      } catch (e) {
        console.error(e);
      }
      return;
    }

    // One request now, not two. It writes the row and sends the notification
    // together, so a tab that dies mid-send can no longer produce a delivered
    // but silent message. `expiry_at` is the server's to work out — see
    // src/app/api/messages.
    const payload = {
      conversationId,
      messageType: data.message_type,
      content: data.content || '',
      mediaUrl: data.media_url || '',
      replyToId: replyTo?.id || null,
    };

    setReplyTo(null);
    // Clear the indicator on the other side now rather than letting it time
    // out — the message is on its way, so "still typing" is visibly wrong.
    typingRef.current?.stopTyping();

    await deliver(payload);
  };

  /**
   * MessageInput clears the composer the moment it hands the text over, so a
   * throw here would take the message with it — no bubble, no error, nothing to
   * retry. Holding the payload is what makes the Retry button possible. Rate
   * limiting on /api/messages makes this a real outcome rather than a
   * theoretical one.
   */
  const deliver = async (payload) => {
    setSendError(null);
    try {
      const sent = await sendMessage(payload);

      // Show it immediately, rather than waiting for realtime to tell us about
      // our own message.
      //
      // The row is already written and the response carries it, so there is no
      // server opinion left to wait for — yet the thread used to render nothing
      // until the subscription fired and triggered a reload. That made the
      // composer depend on a websocket for something it already had, and it
      // failed visibly: two browser-suite assertions once went red on a run
      // where every POST /api/messages returned 200 and the message simply
      // never appeared.
      //
      // Appending is safe against the reload that follows. `loadMessages()`
      // replaces the array wholesale from the database, which by then contains
      // this row — so the optimistic copy is replaced by an identical one
      // rather than duplicated. The id guard covers the race the other way,
      // where realtime wins and reloads before this line runs.
      if (sent?.id) {
        setMessages((current) =>
          current.some((m) => m.id === sent.id) ? current : [...current, sent]
        );
        messageIdsRef.current.add(sent.id);
      }

      // After the server accepts it, not before — a sound for a message that
      // then fails to send is a lie, and failures are visible enough now
      // (rate limits) to matter.
      playSentSound();
    } catch (e) {
      console.error(e);
      setSendError({ message: e.message || 'Could not send that message.', payload });
    }
  };

  const handleReact = async (message, emoji) => {
    const current = reactions.get(message.id) || [];
    const mine = current.some((r) => r.emoji === emoji && r.account_id === session.id);

    // Optimistic. A reaction is a one-tap gesture and waiting on a round trip
    // to see it land feels broken; the reload below reconciles.
    const next = new Map(reactions);
    next.set(
      message.id,
      mine
        ? current.filter((r) => !(r.emoji === emoji && r.account_id === session.id))
        : [...current, { emoji, account_id: session.id }]
    );
    setReactions(next);

    try {
      await toggleReaction(message.id, session.id, emoji, mine);
    } catch (e) {
      console.error(e);
    }
    setReactions(await getReactions(messages.map((m) => m.id)));
  };

  const handleDelete = async (message) => {
    try {
      await deleteMessageForEveryone(message.id);
      await loadMessages();
    } catch (e) {
      console.error(e);
    }
  };

  /**
   * Hide it from this account only. Optimistic, because the row is the caller's
   * own and nobody else's copy is involved — there is no state to reconcile
   * with, so waiting on the round trip would only make it feel slow. On failure
   * the reload puts it back rather than leaving a message that looks gone and
   * is not.
   */
  const handleHide = async (message) => {
    setMessages((current) => current.filter((m) => m.id !== message.id));
    try {
      await hideMessageForMe(message.id, session.id);
    } catch (e) {
      console.error(e);
      setSendError({
        message: /message_hides/i.test(e.message || '')
          ? 'Delete for me needs migration 0016 — see FOLLOWUPS.'
          : e.message || 'Could not hide that message.',
        payload: null,
      });
      await loadMessages();
    }
  };

  /** Resolves a reply_to_id into something the bubble can quote. */
  const quoteFor = (message) => {
    if (!message.reply_to_id) return null;

    // On screen first, then the batch fetched for quotes older than the loaded
    // 200. Only the first case can be scrolled to, because only it is rendered.
    const onScreen = messages.find((m) => m.id === message.reply_to_id);
    const original = onScreen || quotedById.get(message.reply_to_id);

    // Still nothing means deleted or expired — genuinely unavailable, which is
    // what the bubble will say. Being merely old is no longer in this bucket.
    if (!original || original.deleted_at) return null;

    const member = members.find((m) => m.id === original.sender_id);
    return {
      id: original.id,
      canJump: Boolean(onScreen),
      senderName:
        original.sender_id === session.id
          ? 'You'
          : member?.display_name || member?.username || otherUser?.display_name || otherUser?.username || 'Unknown',
      preview:
        original.message_type === 'text'
          ? original.content || ''
          : original.message_type === 'image'
            ? '📷 Photo'
            : original.message_type === 'video'
              ? '🎥 Video'
              : original.message_type === 'voice'
                ? '🎤 Voice message'
                : '📎 Attachment',
    };
  };

  /**
   * Scrolls to the message a reply is quoting, and flashes it.
   *
   * The flash is the point: on a busy thread, scrolling alone leaves you
   * wondering which of the messages now on screen you were sent to. Only
   * offered for originals actually rendered — see `canJump` in quoteFor.
   */
  const jumpToMessage = (messageId) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightId(messageId);
    window.setTimeout(() => {
      setHighlightId((current) => (current === messageId ? null : current));
    }, 1600);
  };

  const applyMute = async (hours) => {
    try {
      const row = await muteConversation(session.id, conversationId, hours);
      setMute(row);
    } catch (e) {
      console.error(e);
    }
    setShowMute(false);
  };

  const removeMute = async () => {
    try {
      await unmuteConversation(conversationId);
      setMute(null);
    } catch (e) {
      console.error(e);
    }
    setShowMute(false);
  };

  const setTimer = async (seconds) => {
    await updateDisappearingTimer(conversationId, seconds);
    setConversation({ ...conversation, disappearing_timer: seconds });
    setShowTimer(false);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (!conversation) {
    return <div className="flex items-center justify-center h-full text-muted-foreground">Conversation not found</div>;
  }

  const title = conversation.type === 'group' ? conversation.name : (otherUser?.display_name || otherUser?.username || 'Chat');
  const avatar = conversation.type === 'group' ? conversation.cover_image : otherUser?.avatar;
  const online = conversation.type === 'direct' && otherUser?.is_online;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Bar spans the pane; its contents track the thread's column so the
          avatar and the messages below it share a left edge. */}
      <div className="border-b-2 border-foreground bg-background">
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 max-w-3xl mx-auto w-full relative">
        <Link to="/home" className="md:hidden text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <Avatar src={avatar} name={title} size={40} online={online} isGroup={conversation.type === 'group'} />
        {/* On a group the header is the way into member management — the
            convention everywhere else, and it avoids a sixth header button. */}
        {conversation.type === 'group' ? (
          <button
            onClick={() => setShowGroupInfo(true)}
            className="flex-1 min-w-0 text-left"
            aria-label="Group info and members"
          >
            <p className="font-display font-bold text-foreground text-lg truncate leading-tight">{title}</p>
            <p className="text-[11px] font-semibold text-muted-foreground">
              {conversation.participant_ids.length} members · tap for info
            </p>
          </button>
        ) : (
          <div className="flex-1 min-w-0">
            <p className="font-display font-bold text-foreground text-lg truncate leading-tight">{title}</p>
            <p className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
              <Shield className="w-3 h-3" /> Encrypted in transit
            </p>
          </div>
        )}
        {/* SIX ACTIONS DO NOT FIT ON A PHONE unless they are told not to shrink.
            Without this group the flex row compressed the buttons and let the
            title wrap underneath them — at 390px "Encrypted in transit" sat on
            top of the call icons. The group holds its width and the title
            truncates instead, which is the right thing to sacrifice. */}
        <div className="flex items-center gap-0 sm:gap-0.5 shrink-0">
        {/* Direct conversations only — group calls need an SFU (FOLLOWUPS §1),
            and a button that rings nobody is what was removed here once before.
            Two buttons rather than one with a menu: choosing audio or video is
            the decision, and it is made before the call, not during it. */}
        {conversation?.type === 'direct' && (
          <>
            <button
              onClick={() =>
                startCall({
                  conversationId,
                  meId: session.id,
                  peerName: otherUser?.display_name || otherUser?.username || 'Someone',
                })
              }
              disabled={getCallState().status !== 'idle'}
              aria-label={`Call ${otherUser?.display_name || otherUser?.username || 'them'}`}
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition disabled:opacity-40"
            >
              <Phone className="w-5 h-5" />
            </button>
            <button
              onClick={() =>
                startCall({
                  conversationId,
                  meId: session.id,
                  peerName: otherUser?.display_name || otherUser?.username || 'Someone',
                  video: true,
                })
              }
              disabled={getCallState().status !== 'idle'}
              aria-label={`Video call ${otherUser?.display_name || otherUser?.username || 'them'}`}
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition disabled:opacity-40"
            >
              <Video className="w-5 h-5" />
            </button>
          </>
        )}
        <button onClick={() => setShowReport(true)} className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition">
          <Flag className="w-5 h-5" />
        </button>
        <button
          onClick={() => setConfirmDeleteChat(true)}
          aria-label="Delete this chat"
          className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-secondary transition"
        >
          <Trash2 className="w-5 h-5" />
        </button>
        <div className="relative">
          <button
            onClick={() => setShowMute(!showMute)}
            aria-label={mute ? 'Muted — change' : 'Mute this conversation'}
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition"
          >
            {mute ? <BellOff className="w-5 h-5 text-primary" /> : <Bell className="w-5 h-5" />}
          </button>
          {showMute && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMute(false)} />
              <div className="absolute right-0 top-11 z-50 bg-card border border-border rounded-xl shadow-xl py-1 w-56">
                <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Notifications
                </p>
                {mute ? (
                  <>
                    <p className="px-3 pb-1.5 text-xs text-muted-foreground">
                      {mute.muted_until
                        ? `Muted until ${new Date(mute.muted_until).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
                        : 'Muted indefinitely'}
                    </p>
                    <button
                      onClick={removeMute}
                      className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-secondary transition"
                    >
                      Unmute
                    </button>
                  </>
                ) : (
                  MUTE_OPTIONS.map((option) => (
                    <button
                      key={option.label}
                      onClick={() => applyMute(option.hours)}
                      className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-secondary transition"
                    >
                      {option.label}
                    </button>
                  ))
                )}
                {/* Muting stops the push, not the message. Worth saying — people
                    reasonably wonder whether they are also blocking someone. */}
                <p className="px-3 pt-1.5 pb-1 text-[11px] text-muted-foreground border-t border-border mt-1">
                  You still receive messages. Your phone just stays quiet.
                </p>
              </div>
            </>
          )}
        </div>
        <div className="relative">
          <button onClick={() => setShowTimer(!showTimer)} className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition">
            <Flame className={`w-5 h-5 ${conversation.disappearing_timer > 0 ? 'text-primary' : ''}`} />
          </button>
          {showTimer && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowTimer(false)} />
              <div className="absolute right-0 top-11 z-50 bg-card border border-border rounded-xl shadow-xl py-1 w-44">
                <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Disappearing</p>
                {TIMERS.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setTimer(t.value)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary transition ${
                      conversation.disappearing_timer === t.value ? 'text-primary font-medium' : 'text-foreground'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        </div>
      </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 bg-secondary">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Shield className="w-12 h-12 text-muted-foreground opacity-30 mb-3" />
            <p className="text-sm text-muted-foreground">Only people in this chat can see these messages</p>
            <p className="text-xs text-muted-foreground mt-1">Say hello to start the conversation</p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto w-full space-y-2">
          {messages.map((msg, i) => {
            const isOwn = msg.sender_id === session.id;
            const prevMsg = messages[i - 1];
            const showSender = conversation.type === 'group' && !isOwn && (!prevMsg || prevMsg.sender_id !== msg.sender_id);
            let senderName = '';
            if (showSender) {
              const member = members.find((m) => m.id === msg.sender_id);
              senderName = member?.display_name || member?.username || 'Unknown';
            }
            return (
              <MessageBubble
                key={msg.id}
                message={msg}
                isOwn={isOwn}
                senderName={senderName}
                showSender={showSender}
                replyTo={quoteFor(msg)}
                reactions={reactions.get(msg.id) || []}
                myAccountId={session.id}
                onReply={setReplyTo}
                onEdit={setEditing}
                onDelete={handleDelete}
                onHide={handleHide}
                onReact={handleReact}
                onJumpTo={jumpToMessage}
                highlighted={highlightId === msg.id}
              />
            );
          })}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {typingNames.length > 0 && (
        <div className="px-4 pb-1 bg-secondary">
          <p className="max-w-3xl mx-auto w-full text-xs text-muted-foreground flex items-center gap-1.5">
            {/* Three dots that stagger rather than pulse together — a flat
                blinking row reads as a loading spinner, not as someone typing. */}
            <span className="flex gap-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
            {typingNames.length === 1
              ? `${typingNames[0]} is typing`
              : typingNames.length === 2
                ? `${typingNames[0]} and ${typingNames[1]} are typing`
                : `${typingNames.length} people are typing`}
          </p>
        </div>
      )}

      {sendError && (
        <div className="px-4 pb-1 bg-secondary">
          <div className="max-w-3xl mx-auto w-full flex items-center gap-2 text-xs text-destructive">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1 min-w-0 truncate">{sendError.message}</span>
            {/* Only a failed send has something to retry. The same strip also
                carries failures that have no payload behind them — hiding a
                message, say — and offering Retry there would re-send nothing. */}
            {sendError.payload ? (
              <button
                type="button"
                onClick={() => deliver(sendError.payload)}
                className="shrink-0 font-medium underline underline-offset-2"
              >
                Retry
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setSendError(null)}
                className="shrink-0 font-medium underline underline-offset-2"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}

      <MessageInput
        onSend={handleSend}
        replyTo={replyTo ? quoteFor({ reply_to_id: replyTo.id }) : null}
        onCancelReply={() => setReplyTo(null)}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
        onTyping={() => typingRef.current?.notifyTyping()}
      />
      {confirmDeleteChat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-foreground/40">
          <div className="w-full max-w-sm bg-card border-2 border-foreground rounded-2xl shadow-pop p-5">
            <h2 className="text-lg font-display font-extrabold text-foreground">
              Delete this chat?
            </h2>
            <p className="text-sm text-muted-foreground mt-2">
              It disappears from your list and you stop seeing these messages.
              {otherUser ? ` ${otherUser.display_name || otherUser.username} keeps their copy` : ' Everyone else keeps their copy'} —
              this only clears yours. If they message you again the chat comes
              back, with the new messages only.
            </p>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setConfirmDeleteChat(false)}
                className="flex-1 py-2.5 rounded-xl border-2 border-foreground bg-card font-bold text-sm"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setConfirmDeleteChat(false);
                  try {
                    await hideConversation(conversationId, session.id);
                    navigate('/home');
                  } catch (e) {
                    console.error(e);
                    setSendError({
                      message: /conversation_hides/i.test(e.message || '')
                        ? 'Delete chat needs migration 0023.'
                        : e.message || 'Could not delete that chat.',
                      payload: null,
                    });
                  }
                }}
                className="flex-1 py-2.5 rounded-xl border-2 border-foreground bg-destructive text-destructive-foreground font-bold text-sm"
              >
                Delete for me
              </button>
            </div>
          </div>
        </div>
      )}

      <ReportDialog open={showReport} onClose={() => setShowReport(false)} reportedId={otherUser?.id || ''} reportedName={otherUser?.display_name || otherUser?.username || ''} />
      <GroupInfoDialog
        open={showGroupInfo}
        onClose={() => setShowGroupInfo(false)}
        conversation={conversation}
        members={members}
        onChanged={async () => {
          // Membership changes rewrite participant_ids, which decides who the
          // header, the member list and RLS itself consider part of this
          // conversation — so the whole conversation is reloaded, not patched.
          await loadConversation();
          // Leaving removes you from participant_ids, at which point RLS stops
          // returning the conversation at all. Get out before rendering a
          // screen the database will no longer answer questions about.
          const stillIn = await getConversation(conversationId).catch(() => null);
          if (!stillIn) navigate('/home');
        }}
      />
    </div>
  );
}