import Logo from './Logo';

export default function EmptyState() {
  return (
    <div className="hidden md:flex h-full flex-col items-center justify-center text-center px-8">
      <Logo className="w-20 h-20 mb-6" />
      <h2 className="text-2xl font-heading font-bold text-foreground mb-2">Your messages are private</h2>
      <p className="text-muted-foreground max-w-sm">
        Select a conversation to start chatting. Messages are encrypted in transit and only visible to people in the chat.
      </p>
    </div>
  );
}