import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import ConversationList from './ConversationList';
import BottomNav from './BottomNav';
import { cleanupExpiredMessages } from '@/lib/heychatAuth';

export default function AppLayout() {
  const location = useLocation();

  useEffect(() => { cleanupExpiredMessages(); }, []);

  // On a phone a conversation takes the whole screen and its composer sits
  // exactly where the nav would be, so the nav steps aside — the header's back
  // arrow is the way out. Everywhere else it stays put.
  const inConversation = location.pathname.startsWith('/chat/');

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <aside className="hidden md:flex w-80 lg:w-96 flex-col border-r border-border bg-sidebar/50 backdrop-blur-sm">
        <div className="flex-1 min-h-0">
          <ConversationList />
        </div>
        <BottomNav />
      </aside>

      {/* min-w-0 stops long message text from forcing this column wider than
          the viewport and pushing the sidebar off-screen. */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <main className="flex-1 min-h-0 overflow-hidden">
          <Outlet />
        </main>
        {!inConversation && <BottomNav className="md:hidden" />}
      </div>
    </div>
  );
}
