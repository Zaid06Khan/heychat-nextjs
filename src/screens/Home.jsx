import EmptyState from '@/components/heychat/EmptyState';

/**
 * On desktop this is the pane beside the conversation list, so it is the "pick
 * a conversation" placeholder. On a phone `/home` *is* the list, which AppLayout
 * renders — this screen is hidden there, and EmptyState is `hidden md:flex`
 * besides.
 *
 * It used to render a second ConversationList of its own. See AppLayout.
 */
export default function Home() {
  return <EmptyState />;
}
