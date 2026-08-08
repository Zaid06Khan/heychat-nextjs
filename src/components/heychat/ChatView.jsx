import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { getSession } from '@/lib/heychatAuth';
import { ArrowLeft, Video, Shield, Flame, Flag } from 'lucide-react';
import Avatar from './Avatar';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import ReportDialog from './ReportDialog';

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
      unsub = base44.entities.Message.subscribe((event) => {
        if (event.data?.conversation_id === conversationId) loadMessages();
      });
    })();
    return () => { if (unsub) unsub(); };
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
      const now = new Date();
      const active = msgs.filter((m) => !m.expiry_at || new Date(m.expiry_at) > now);
      setMessages(active);
      const expired = msgs.filter((m) => m.expiry_at && new Date(m.expiry_at) <= now);
      if (expired.length > 0) {
        await base44.entities.Message.deleteMany({ conversation_id: conversationId, expiry_at: { $lt: now.toISOString() } });
      }
      for (const msg of active) {
        if (msg.sender_id !== session.id && (!msg.read_by || !msg.read_by.includes(session.id))) {
          const readBy = msg.read_by || [];
          await base44.entities.Message.update(msg.id, { read_by: [...readBy, session.id] });
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async (data) => {
    if (!conversation) return;
    const expiry_at = conversation.disappearing_timer > 0
      ? new Date(Date.now() + conversation.disappearing_timer * 1000).toISOString()
      : null;
    await base44.entities.Message.create({
      conversation_id: conversationId,
      sender_id: session.id,
      content: data.content || '',
      media_url: data.media_url || '',
      message_type: data.message_type,
      expiry_at,
      read_by: [session.id],
    });
  };

  const setTimer = async (seconds) => {
    await base44.entities.Conversation.update(conversationId, { disappearing_timer: seconds });
    setConversation({ ...conversation, disappearing_timer: seconds });
    setShowTimer(false);
  };

  const startCall = () => navigate(`/call/${conversationId}`);

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
        <div className="flex-1 min-w-0">
          <p className="font-display font-bold text-foreground text-lg truncate leading-tight">{title}</p>
          <p className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
            <Shield className="w-3 h-3" /> Encrypted in transit
          </p>
        </div>
        <button onClick={startCall} className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition">
          <Video className="w-5 h-5" />
        </button>
        <button onClick={() => setShowReport(true)} className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition">
          <Flag className="w-5 h-5" />
        </button>
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
            return <MessageBubble key={msg.id} message={msg} isOwn={isOwn} senderName={senderName} showSender={showSender} />;
          })}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <MessageInput onSend={handleSend} />
      <ReportDialog open={showReport} onClose={() => setShowReport(false)} reportedId={otherUser?.id || ''} reportedName={otherUser?.display_name || otherUser?.username || ''} />
    </div>
  );
}