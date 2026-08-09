import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import ConversationList from './ConversationList';
import BottomNav from './BottomNav';
import { syncPushSubscription } from '@/lib/push/client';

export default function AppLayout() {
  const location = useLocation();

  // The cleanupExpiredMessages() call that used to be here is gone — expiry is
  // a scheduled server sweep now, so it no longer depends on someone opening
  // the app. See 0010_expiry_sweep.sql.

  // Re-assert the push subscription on every start of the signed-in app.
  //
  // This never prompts — it returns immediately unless permission was already
  // granted, so it cannot burn the one permission request the browser allows.
  // It is here rather than in a one-off opt-in because push subscriptions
  // expire and get rotated by the push service, and the failure is silent: the
  // user believes notifications are on and simply stops receiving them.
  useEffect(() => {
    syncPushSubscription();

    // The service worker cannot re-subscribe by itself (it has no access to the
    // VAPID key), so on `pushsubscriptionchange` it asks whichever page is open
    // to do it. See public/sw.js.
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event) => {
      if (event.data?.type === 'PUSH_SUBSCRIPTION_CHANGED') syncPushSubscription();
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  // On a phone a conversation takes the whole screen and its composer sits
  // exactly where the nav would be, so the nav steps aside — the header's back
  // arrow is the way out. Everywhere else it stays put.
  const inConversation = location.pathname.startsWith('/chat/');

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Full-strength sidebar fill and a 2px ink edge: Bodega separates panes
          with weight, not with translucency and blur. */}
      <aside className="hidden md:flex w-80 lg:w-96 flex-col border-r-2 border-foreground bg-sidebar">
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
