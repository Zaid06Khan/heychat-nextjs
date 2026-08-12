import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { getSession, getCurrentAccount } from '@/lib/heychatAuth';
import { requestPushForMessage } from '@/lib/push/client';
import { getMute, muteConversation, unmuteConversation, MUTE_OPTIONS } from '@/lib/notifications/mutes';
import {
  getReactions,
  toggleReaction,
  editMessage,
  deleteMessageForEveryone,
} from '@/lib/messages/interactions';
import { createTypingChannel } from '@/lib/messages/typing';
import { markRead } from '@/lib/unread';
import { ArrowLeft, Shield, Flame, Flag, Bell, BellOff } from 'lucide-react';
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
  const typingRef = useRef(null);
  const [otherUser, setOtherUser] = useState(null);
  const [members, setMembers] = useState([]);
  const messagesEndRef = useRef(null);
  const session = getSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!conversationId) return;
    let unsub;
    (async () => {
      await loadConversation();
      await loadMessages();
      setMute(await getMute(conversationId));
      unsub = base44.entities.Message.subscribe((event) => {
        if (event.data?.conversation_id === conversationId) loadMessages();
      });

      const me = await getCurrentAccount();
      typingRef.current = createTypingChannel({
        conversationId,
        accountId: session.id,
        displayName: me?.display_name || me?.username || 'Someone',
        onChange: setTypingNames,
      });
    })();

    return () => {
      if (unsub) unsub();
      typingRef.current?.close();
      typingRef.current = null;
      setTypingNames([]);
    };
  }, [conversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadConversation = async () => {
    try {
      const conv = await base44.entities.Conversation.get(conversationId);
      setConversation(conv);
      if (conv.type === 'direct') {
        const otherId = conv.participant_ids.find((id) => id !== session.id);
        if (otherId) {
          const acc = await base44.entities.Account.get(otherId);
          setOtherUser(acc);
        }
      } else {
        const accs = await Promise.all(
          conv.participant_ids.map((id) => base44.entities.Account.get(id).catch(() => null))
        );
        setMembers(accs.filter(Boolean));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadMessages = async () => {
    try {
      const msgs = await base44.entities.Message.filter(
        { conversation_id: conversationId }, 'created_date', 200
      );
      // Still filtered here, but no longer deleted here. The sweep runs every
      // five minutes (0010), so a row can outlive its expiry by a few minutes —
      // hiding it locally keeps "disappearing" honest on screen in the gap.
      const now = new Date();
      const active = msgs.filter((m) => !m.expiry_at || new Date(m.expiry_at) > now);
      setMessages(active);

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

    const expiry_at = conversation.disappearing_timer > 0
      ? new Date(Date.now() + conversation.disappearing_timer * 1000).toISOString()
      : null;
    const message = await base44.entities.Message.create({
      conversation_id: conversationId,
      sender_id: session.id,
      content: data.content || '',
      media_url: data.media_url || '',
      message_type: data.message_type,
      expiry_at,
      read_by: [session.id],
      reply_to_id: replyTo?.id || null,
    });
    setReplyTo(null);
    // Clear the indicator on the other side now rather than letting it time
    // out — the message has arrived, so "still typing" is visibly wrong.
    typingRef.current?.stopTyping();

    // Fire-and-forget: the message is already saved, and the recipient sees it
    // in-app through the realtime subscription regardless. This only decides
    // whether their phone lights up. Deliberately not awaited — a slow push
    // service must not hold up the composer. See src/app/api/push/notify.
    requestPushForMessage(message?.id);
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

  /** Resolves a reply_to_id into something the bubble can quote. */
  const quoteFor = (message) => {
    if (!message.reply_to_id) return null;
    const original = messages.find((m) => m.id === message.reply_to_id);
    // Not found means it was deleted, expired, or scrolled out of the 200 the
    // thread loads. The bubble renders "original message unavailable" either
    // way, which is honest without pretending to know which.
    if (!original || original.deleted_at) return null;

    const member = members.find((m) => m.id === original.sender_id);
    return {
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
    await base44.entities.Conversation.update(conversationId, { disappearing_timer: seconds });
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
      <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto w-full relative">
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
        {/* The call button is deliberately absent. CallOverlay renders your own
            camera and nothing else — there is no RTCPeerConnection, no
            signalling and no TURN, so two people "on a call" each see
            themselves. Shipping a button that looks like it works is worse
            than not having one. The /call route still exists so the screen can
            be developed against; see FOLLOWUPS.md §1. */}
        <button onClick={() => setShowReport(true)} className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition">
          <Flag className="w-5 h-5" />
        </button>
        <div className="relative">
          <button
            onClick={() => setShowMute(!showMute)}
            aria-label={mute ? 'Muted — change' : 'Mute this conversation'}
            className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition"
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
          <button onClick={() => setShowTimer(!showTimer)} className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition">
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
                onReact={handleReact}
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

      <MessageInput
        onSend={handleSend}
        replyTo={replyTo ? quoteFor({ reply_to_id: replyTo.id }) : null}
        onCancelReply={() => setReplyTo(null)}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
        onTyping={() => typingRef.current?.notifyTyping()}
      />
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
          const stillIn = await base44.entities.Conversation.get(conversationId).catch(() => null);
          if (!stillIn) navigate('/home');
        }}
      />
    </div>
  );
}