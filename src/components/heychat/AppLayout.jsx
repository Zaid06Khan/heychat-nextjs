import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import ConversationList from './ConversationList';
import { cleanupExpiredMessages } from '@/lib/heychatAuth';

export default function AppLayout() {
  useEffect(() => { cleanupExpiredMessages(); }, []);
  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <aside className="hidden md:flex w-80 lg:w-96 flex-col border-r border-border bg-sidebar/50 backdrop-blur-sm">
        <ConversationList />
      </aside>
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}