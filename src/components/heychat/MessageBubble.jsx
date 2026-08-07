import { Image } from '@/components/ui/image';
import { Check, CheckCheck, Flame, FileText, Play } from 'lucide-react';

export default function MessageBubble({ message, isOwn, senderName, showSender }) {
  const time = new Date(message.created_date || message.sent_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const isRead = message.read_by && message.read_by.length > 1;

  const renderContent = () => {
    switch (message.message_type) {
      case 'image':
        return (
          <div className="rounded-lg overflow-hidden max-w-xs">
            <Image
              src={message.media_url}
              alt="photo"
              className="w-full h-auto"
              fittingType="fit"
            />
            {message.content && <p className="px-2 pt-1 text-sm">{message.content}</p>}
          </div>
        );
      case 'video':
        return (
          <div className="rounded-lg overflow-hidden max-w-xs">
            <video src={message.media_url} controls className="w-full h-auto rounded-lg" />
          </div>
        );
      case 'voice':
        return (
          <div className="flex items-center gap-2 py-1">
            <audio src={message.media_url} controls className="h-8 max-w-[200px]" />
          </div>
        );
      case 'file':
        return (
          <a
            href={message.media_url}
            download
            className="flex items-center gap-2 py-1 hover:opacity-80"
          >
            <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center">
              <FileText className="w-4 h-4 text-primary" />
            </div>
            <span className="text-sm underline">{message.content || 'File'}</span>
          </a>
        );
      default:
        return <p className="whitespace-pre-wrap break-words">{message.content}</p>;
    }
  };

  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} animate-message-in`}>
      <div
        className={`max-w-[75%] md:max-w-[65%] rounded-2xl px-3 py-2 ${
          isOwn
            ? 'bg-primary text-primary-foreground rounded-br-md'
            : 'bg-card text-card-foreground rounded-bl-md'
        }`}
      >
        {showSender && !isOwn && (
          <p className="text-xs font-semibold text-accent mb-0.5">{senderName}</p>
        )}
        {renderContent()}
        <div className={`flex items-center gap-1 mt-0.5 ${isOwn ? 'justify-end' : 'justify-end'}`}>
          {message.expiry_at && <Flame className="w-3 h-3 opacity-60" />}
          <span className="text-[10px] opacity-60">{time}</span>
          {isOwn && (isRead ? <CheckCheck className="w-3 h-3" /> : <Check className="w-3 h-3" />)}
        </div>
      </div>
    </div>
  );
}