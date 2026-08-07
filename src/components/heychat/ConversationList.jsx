import { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { getSession, logout, getCurrentAccount } from '@/lib/heychatAuth';
import { MessageCircle, Users, User, Plus, Search } from 'lucide-react';
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
    let unsubMsg, unsubConv;
    (async () => {
      const acc = await getCurrentAccount();
      setAccount(acc);
      await loadConversations();
      unsubMsg = base44.entities.Message.subscribe(() => loadConversations());
      unsubConv = base44.entities.Conversation.subscribe(() => loadConversations());
    })();
    return () => {
      if (unsubMsg) unsubMsg();
      if (unsubConv) unsubConv();
    };
  }, []);

  const loadConversations = async () => {
    try {
      const convs = await base44.entities.Conversation.filter(
        { participant_ids: session.id }, '-updated_date', 50
      );
      const enriched = await Promise.all(
        convs.map(async (conv) => {
          let name = 'Conversation', avatar = '', online = false;
          if (conv.type === 'group') {
            name = conv.name || 'Group';
            avatar = conv.cover_image;
          } else {
            const otherId = conv.participant_ids.find((id) => id !== session.id);
            if (otherId) {
              try {
                const acc = await base44.entities.Account.get(otherId);
                name = acc.display_name || acc.username;
                avatar = acc.avatar;
                online = acc.is_online;
              } catch {}
            }
          }
          let lastMsg = null;
          try {
            const msgs = await base44.entities.Message.filter(
              { conversation_id: conv.id }, '-created_date', 1
            );
            lastMsg = msgs[0];
          } catch {}
          return { ...conv, displayName: name, displayAvatar: avatar, online, lastMsg };
        })
      );
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
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <Link to="/home" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl gradient-bg flex items-center justify-center">
              <Logo className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-heading font-bold gradient-text">HeyChat</span>
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
        <Link to="/contacts" className="flex items-center gap-2 bg-secondary rounded-xl px-3 py-2.5">
          <Search className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Search contacts...</span>
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
              className={`flex items-center gap-3 px-4 py-3 transition border-b border-border/50 ${
                isActive(conv.id) ? 'bg-primary/10' : 'hover:bg-secondary/30'
              }`}
            >
              <Avatar src={conv.displayAvatar} name={conv.displayName} size={48} online={conv.online} isGroup={conv.type === 'group'} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-foreground text-sm truncate">
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
              {conv.disappearing_timer > 0 && <span className="text-sm">🔥</span>}
            </Link>
          ))
        )}
      </div>

      <GroupCreateDialog open={showGroupDialog} onClose={() => setShowGroupDialog(false)} onCreated={(conv) => navigate(`/chat/${conv.id}`)} />
    </div>
  );
}