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
    <nav className={`px-2 pt-2 pb-3 border-t-2 border-foreground bg-background flex items-end justify-around ${className}`}>
      {ITEMS.map(({ to, icon: Icon, label }) => {
        const active = location.pathname === to;
        // Earn is the reason someone opens this app twice. It gets to sit
        // proud of the row in citrus rather than queue up as a fifth grey icon.
        const isEarn = to === '/earn';
        return (
          <Link
            key={to}
            to={to}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition ${
              isEarn
                ? '-mt-3 bg-accent text-accent-foreground border-2 border-foreground shadow-pop-sm hover:-translate-y-0.5'
                : active
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="w-5 h-5" strokeWidth={2.25} />
            <span className="text-[10px] font-bold tracking-tight">{t(label)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
