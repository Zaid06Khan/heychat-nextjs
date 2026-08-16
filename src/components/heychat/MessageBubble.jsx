import { useState, useRef } from 'react';
import { Image } from '@/components/ui/image';
import { Check, CheckCheck, Flame, FileText, MoreHorizontal, Reply, Pencil, Trash2, SmilePlus, EyeOff } from 'lucide-react';
import { useSignedMedia } from '@/lib/media/useSignedMedia';
import { QUICK_REACTIONS, summariseReactions } from '@/lib/messages/interactions';

export default function MessageBubble({
  message,
  isOwn,
  senderName,
  showSender,
  replyTo,
  reactions = [],
  myAccountId,
  onReply,
  onEdit,
  onDelete,
  onHide,
  onReact,
  onJumpTo,
  highlighted,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openUp, setOpenUp] = useState(true);
  const triggerRef = useRef(null);

  const time = new Date(message.created_date || message.sent_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const isRead = message.read_by && message.read_by.length > 1;
  const isDeleted = Boolean(message.deleted_at);

  // The media bucket is private (0006), so media_url is a storage key rather
  // than something a browser can fetch. It is exchanged for a short-lived
  // signed URL, and only if the server agrees this reader is in the
  // conversation. Text messages never call out.
  const hasMedia = Boolean(message.media_url) && message.message_type !== 'text' && !isDeleted;
  const { url: mediaUrl, loading, failed } = useSignedMedia(
    hasMedia ? { messageId: message.id } : {}
  );

  const summary = summariseReactions(reactions, myAccountId);

  // Editing only makes sense for text you still own. An image caption is
  // deliberately out of scope rather than half-supported.
  const canEdit = isOwn && !isDeleted && message.message_type === 'text';

  const closeMenus = () => {
    setMenuOpen(false);
    setPickerOpen(false);
  };

  /**
   * Decides which way the menu opens before showing it.
   *
   * It used to always open upward. The thread scrolls inside an `overflow-y-auto`
   * container, so for any message near the top of it the menu was pushed past
   * the container's edge and clipped — invisible, unclickable, and sitting
   * behind the sticky header. That is not an edge case: a new conversation with
   * three messages has all three near the top.
   *
   * Measured against the viewport rather than the scroll container because the
   * container occupies nearly all of it, and one getBoundingClientRect beats
   * threading a ref down from ChatView for the few pixels of difference.
   */
  const MENU_HEIGHT = 210;

  const openMenu = () => {
    if (menuOpen || pickerOpen) {
      closeMenus();
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setOpenUp(rect.top > MENU_HEIGHT);
    setMenuOpen(true);
    setPickerOpen(false);
  };

  const renderContent = () => {
    if (isDeleted) {
      return <p className="text-sm italic opacity-60 py-0.5">This message was deleted</p>;
    }
    if (hasMedia && loading) {
      return <div className="w-48 h-32 rounded-lg bg-foreground/10 animate-pulse" />;
    }
    if (hasMedia && (failed || !mediaUrl)) {
      return (
        <p className="text-sm italic opacity-70 py-1">
          This attachment couldn&apos;t be loaded.
        </p>
      );
    }

    switch (message.message_type) {
      case 'image':
        return (
          <div className="rounded-lg overflow-hidden max-w-xs">
            <Image
              src={mediaUrl}
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
            <video src={mediaUrl} controls className="w-full h-auto rounded-lg" />
          </div>
        );
      case 'voice':
        return (
          <div className="flex items-center gap-2 py-1">
            <audio src={mediaUrl} controls className="h-8 max-w-[200px]" />
          </div>
        );
      case 'file':
        return (
          <a
            href={mediaUrl}
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
    // The id is the jump target for a reply quote pointing at this message,
    // and `highlighted` is the flash that follows the scroll — without it you
    // arrive somewhere in the thread with no idea which message you were sent
    // to. A ring rather than a background change, so it reads on both the
    // paper and the electric-blue bubble.
    <div
      id={`msg-${message.id}`}
      className={`group flex ${isOwn ? 'justify-end' : 'justify-start'} animate-message-in ${
        highlighted ? 'rounded-2xl ring-2 ring-accent ring-offset-2 ring-offset-secondary transition-shadow' : ''
      }`}
    >
      <div className={`flex items-center gap-1 max-w-[85%] ${isOwn ? 'flex-row' : 'flex-row-reverse'}`}>
        {/* The action affordance sits outside the bubble so it never covers the
            text. Hidden until hover on a pointer device; on touch there is no
            hover, so `focus-within` and an always-visible-on-small-screens
            fallback keep it reachable. */}
        {!isDeleted && (
          <div className="relative self-center shrink-0">
            <button
              ref={triggerRef}
              onClick={openMenu}
              aria-label="Message actions"
              className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition opacity-60 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {(menuOpen || pickerOpen) && (
              <>
                <div className="fixed inset-0 z-40" onClick={closeMenus} />
                <div
                  className={`absolute z-50 ${openUp ? 'bottom-9' : 'top-9'} ${isOwn ? 'right-0' : 'left-0'} bg-card border border-border rounded-xl shadow-xl py-1 w-44`}
                >
                  {pickerOpen ? (
                    <div className="flex items-center justify-between px-2 py-1">
                      {QUICK_REACTIONS.map((emoji) => (
                        <button
                          key={emoji}
                          onClick={() => {
                            onReact?.(message, emoji);
                            closeMenus();
                          }}
                          className="w-7 h-7 rounded-lg text-lg leading-none hover:bg-secondary transition"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => setPickerOpen(true)}
                        className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm text-foreground hover:bg-secondary transition"
                      >
                        <SmilePlus className="w-4 h-4" /> React
                      </button>
                      <button
                        onClick={() => { onReply?.(message); closeMenus(); }}
                        className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm text-foreground hover:bg-secondary transition"
                      >
                        <Reply className="w-4 h-4" /> Reply
                      </button>
                      {canEdit && (
                        <button
                          onClick={() => { onEdit?.(message); closeMenus(); }}
                          className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm text-foreground hover:bg-secondary transition"
                        >
                          <Pencil className="w-4 h-4" /> Edit
                        </button>
                      )}
                      {/* Two different things, so they are named as two
                          different things. Hiding is offered on anyone's
                          message; destroying one is only ever offered on your
                          own, and is the only one drawn in the alert colour. */}
                      <button
                        onClick={() => { onHide?.(message); closeMenus(); }}
                        className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm text-foreground hover:bg-secondary transition"
                      >
                        <EyeOff className="w-4 h-4" /> Delete for me
                      </button>
                      {isOwn && (
                        <button
                          onClick={() => { onDelete?.(message); closeMenus(); }}
                          className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm text-destructive hover:bg-secondary transition"
                        >
                          <Trash2 className="w-4 h-4" /> Delete for everyone
                        </button>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <div className="min-w-0">
          {/* Sticker bubbles: 2px ink border and a hard offset shadow, no blur.
              Both sides carry the same weight — the fill is what tells them apart. */}
          <div
            className={`rounded-2xl px-3.5 py-2.5 border-2 border-foreground shadow-pop-sm ${
              isOwn
                ? 'bg-primary text-primary-foreground rounded-br-md'
                : 'bg-card text-card-foreground rounded-bl-md'
            }`}
          >
            {showSender && !isOwn && (
              <p className="text-xs font-bold font-display text-primary mb-0.5">{senderName}</p>
            )}

            {/* The quoted message. `replyTo` is null when the original has been
                deleted or expired — reply_to_id is ON DELETE SET NULL, so the
                reply outlives what it answered and says so. */}
            {message.reply_to_id && (
              // A button only when there is somewhere to go. An original that
              // is quoted but not itself on screen (older than the loaded 200)
              // still shows its preview — it just cannot be scrolled to,
              // because it is not rendered.
              <div
                {...(replyTo?.canJump
                  ? {
                      role: 'button',
                      tabIndex: 0,
                      onClick: () => onJumpTo?.(replyTo.id),
                      onKeyDown: (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onJumpTo?.(replyTo.id);
                        }
                      },
                      'aria-label': `Go to ${replyTo.senderName}'s message`,
                    }
                  : {})}
                className={`mb-1.5 pl-2 border-l-2 rounded-sm text-xs ${
                  isOwn ? 'border-primary-foreground/40 opacity-80' : 'border-primary opacity-75'
                } ${replyTo?.canJump ? 'cursor-pointer hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring' : ''}`}
              >
                {replyTo ? (
                  <>
                    <p className="font-bold truncate">{replyTo.senderName}</p>
                    <p className="truncate">{replyTo.preview}</p>
                  </>
                ) : (
                  <p className="italic">Original message unavailable</p>
                )}
              </div>
            )}

            {renderContent()}

            <div className="flex items-center gap-1 mt-1 justify-end">
              {message.edited_at && !isDeleted && (
                <span className={`text-[10px] ${isOwn ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                  edited
                </span>
              )}
              {message.expiry_at && <Flame className="w-3 h-3 opacity-70" />}
              <span className={`text-[10px] font-bold tracking-wide ${isOwn ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>{time}</span>
              {isOwn && !isDeleted && (isRead ? <CheckCheck className="w-3 h-3" /> : <Check className="w-3 h-3" />)}
            </div>
          </div>

          {/* Reactions hang under the bubble. Tapping one you already gave
              removes it, which is why `mine` changes the border rather than
              just the fill — it has to read as a toggle, not a tally. */}
          {summary.length > 0 && (
            <div className={`flex flex-wrap gap-1 mt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
              {summary.map(({ emoji, count, mine }) => (
                <button
                  key={emoji}
                  onClick={() => onReact?.(message, emoji)}
                  className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs bg-card transition hover:-translate-y-px ${
                    mine ? 'border-2 border-foreground font-bold' : 'border border-border'
                  }`}
                >
                  <span className="leading-none">{emoji}</span>
                  {count > 1 && <span className="text-[10px] text-muted-foreground">{count}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
