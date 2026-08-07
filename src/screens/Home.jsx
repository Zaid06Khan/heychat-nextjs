import ConversationList from '@/components/heychat/ConversationList';
import EmptyState from '@/components/heychat/EmptyState';

export default function Home() {
  return (
    <>
      <div className="md:hidden h-full">
        <ConversationList />
      </div>
      <EmptyState />
    </>
  );
}