import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import ConversationList from './ConversationList';
import BottomNav from './BottomNav';
import { syncPushSubscription } from '@/lib/push/client';

/**
 * ONE ConversationList AND ONE BottomNav, positioned by CSS.
 *
 * Until 2026-08-14 there were two of each on `/home`. The list lived in this
 * file's sidebar (`hidden md:flex`) *and* inside `Home` (`md:hidden`), because
 * the two places it has to appear are structurally different: a fixed column
 * beside the content on desktop, and the content itself on a phone. Rendering
 * it twice and letting CSS pick was the obvious way to get both, and it cost
 * more than it looked like it did — React mounts what CSS hides, so both copies
 * ran their effects. Two realtime channels, two sets of four queries, and two
 * writes to the unread store per change; a debug run counted four nav badges
 * for one unread message. Most of the work FOLLOWUPS #8 did to get this list
 * down to one channel and four queries was being spent twice over.
 *
 * So both now render exactly once, here, and only their *position* is
 * responsive:
 *
 *   phone   `/home`      the aside fills the screen (list above nav)
 *           elsewhere    the aside shrinks to just the nav, under the content
 *           `/chat/:id`  the aside goes entirely — the composer needs that space
 *                        and the header's back arrow is the way out
 *   desktop always       the aside is the left column, list above nav, content
 *                        to the right
 *
 * DOM ORDER IS [main, aside], WHICH IS DELIBERATE. Any single-render solution
 * has to decouple document order from visual order at one breakpoint or the
 * other, because the nav sits in different places at each. Putting main first
 * means a phone — where content is above the nav — reads and tabs in the order
 * it appears. Desktop pays for it by reaching the sidebar after the content,
 * which is the ordinary "main content first" arrangement and the better half of
 * the trade. `md:order-first` moves the aside left visually.
 */
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

  const inConversation = location.pathname.startsWith('/chat/');
  const onHome = location.pathname === '/home';

  return (
    <div className="flex flex-col md:flex-row h-screen bg-background overflow-hidden">
      {/* min-w-0 stops long message text from forcing this column wider than
          the viewport and pushing the sidebar off-screen. */}
      <div
        className={`${onHome ? 'hidden md:flex' : 'flex'} flex-1 flex-col min-w-0 min-h-0 overflow-hidden`}
      >
        <main className="flex-1 min-h-0 overflow-hidden">
          <Outlet />
        </main>
      </div>

      {/* Full-strength sidebar fill and a 2px ink edge: Bodega separates panes
          with weight, not with translucency and blur. Both are desktop-only —
          on a phone this is either the whole screen or just the nav, and the
          nav brings its own top border. */}
      <aside
        className={`${inConversation ? 'hidden md:flex' : 'flex'} ${onHome ? 'flex-1 min-h-0' : ''}
                    flex-col md:order-first md:flex-none md:w-80 lg:w-96 md:min-h-0
                    bg-background md:bg-sidebar md:border-r-2 border-foreground`}
      >
        {/* Hidden rather than unmounted off `/home`, so a phone moving between
            tabs keeps the list's channel and its data instead of tearing both
            down and refetching on the way back. */}
        <div className={`${onHome ? '' : 'hidden'} md:block flex-1 min-h-0`}>
          <ConversationList />
        </div>
        <BottomNav />
      </aside>
    </div>
  );
}
