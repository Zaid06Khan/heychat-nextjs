import { Link, useLocation } from 'react-router-dom';
import { MessageCircle, Users, User, Settings } from 'lucide-react';
import { t } from '@/lib/i18n';
import { useUnreadTotal } from '@/lib/unread';

const ITEMS = [
  { to: '/home', icon: MessageCircle, label: 'nav.chats' },
  { to: '/contacts', icon: Users, label: 'nav.contacts' },
  { to: '/profile', icon: User, label: 'nav.profile' },
  { to: '/settings', icon: Settings, label: 'nav.settings' },
];

/**
 * Lived inside ConversationList until now, which meant it only rendered where
 * ConversationList did — the sidebar on desktop, and `/home` alone on mobile.
 * Every other mobile screen had no navigation at all. AppLayout owns it now, so
 * it is present wherever the layout is.
 */
export default function BottomNav({ className = '' }) {
  const location = useLocation();
  // Published by ConversationList, which already counts them. No request of
  // its own — see src/lib/unread.js for why this is a store and not a prop.
  const unread = useUnreadTotal();

  return (
    <nav className={`px-2 pt-2 pb-3 border-t-2 border-foreground bg-background flex items-center justify-around ${className}`}>
      {ITEMS.map(({ to, icon: Icon, label }) => {
        const active = location.pathname === to;
        return (
          <Link
            key={to}
            to={to}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition ${
              active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className="relative">
              <Icon className="w-5 h-5" strokeWidth={2.25} />
              {/* Only Chats carries a count — it is the only tab where
                  "something happened while you were away" is a number. */}
              {to === '/home' && unread > 0 && (
                <span
                  aria-label={`${unread} unread`}
                  className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground border-2 border-background text-[9px] font-extrabold flex items-center justify-center"
                >
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </span>
            <span className="text-[10px] font-bold tracking-tight">{t(label)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
