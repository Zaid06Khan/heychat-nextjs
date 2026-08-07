import { Link, useLocation } from 'react-router-dom';
import { MessageCircle, Users, DollarSign, User, Settings } from 'lucide-react';
import { t } from '@/lib/i18n';

const ITEMS = [
  { to: '/home', icon: MessageCircle, label: 'nav.chats' },
  { to: '/contacts', icon: Users, label: 'nav.contacts' },
  { to: '/earn', icon: DollarSign, label: 'nav.earn' },
  { to: '/profile', icon: User, label: 'nav.profile' },
  { to: '/settings', icon: Settings, label: 'nav.settings' },
];

/**
 * Lived inside ConversationList until now, which meant it only rendered where
 * ConversationList did — the sidebar on desktop, and `/home` alone on mobile.
 * Every other mobile screen had no navigation at all, and `/earn` had no way
 * back. AppLayout owns it now, so it is present wherever the layout is.
 */
export default function BottomNav({ className = '' }) {
  const location = useLocation();

  return (
    <nav className={`p-2 border-t border-border flex items-center justify-around ${className}`}>
      {ITEMS.map(({ to, icon: Icon, label }) => {
        const active = location.pathname === to;
        return (
          <Link
            key={to}
            to={to}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition ${
              active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="w-5 h-5" />
            <span className="text-[10px]">{t(label)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
