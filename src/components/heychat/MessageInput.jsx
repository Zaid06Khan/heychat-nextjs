import { useState, useRef, useEffect } from 'react';
import { Core } from '@/lib/media/upload';
import { Send, Paperclip, Mic, Square, X, Reply, Pencil } from 'lucide-react';

export default function MessageInput({
  onSend,
  disabled,
  replyTo,
  onCancelReply,
  editing,
  onCancelEdit,
  onTyping,
}) {
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recTime, setRecTime] = useState(0);
  const fileInputRef = useRef(null);
  const recorderRef = useRef(null);
  const recTimerRef = useRef(null);
  const streamRef = useRef(null);
  const textareaRef = useRef(null);

  // Entering edit mode loads the existing text so it can be changed rather than
  // retyped. Leaving it clears the box, or the old text would linger and get
  // sent as a new message.
  useEffect(() => {
    setText(editing ? editing.content || '' : '');
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  // A reply is aimed at a specific message, so the composer takes focus without
  // the user having to reach for it.
  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  const handleSend = () => {
    if (!text.trim() || disabled) return;
    onSend({ message_type: 'text', content: text.trim() });
    setText('');
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploading(true);
    try {
      const { file_url } = await Core.UploadFile({ file });
      const type = file.type.startsWith('image/')
        ? 'image'
        : file.type.startsWith('video/')
        ? 'video'
        : 'file';
      onSend({ message_type: type, media_url: file_url, content: file.name });
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      const chunks = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
        setUploading(true);
        try {
          const { file_url } = await Core.UploadFile({ file });
          onSend({ message_type: 'voice', media_url: file_url });
        } catch (err) {
          console.error(err);
        } finally {
          setUploading(false);
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setRecTime(0);
      recTimerRef.current = setInterval(() => setRecTime((t) => t + 1), 1000);
    } catch (err) {
      console.error(err);
    }
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    if (recTimerRef.current) clearInterval(recTimerRef.current);
    setRecording(false);
  };

  if (recording) {
    return (
      <div className="bg-background border-t border-border">
        <div className="flex items-center gap-3 px-4 py-3 max-w-3xl mx-auto w-full">
          <div className="flex items-center gap-2 flex-1">
            <span className="w-3 h-3 bg-destructive rounded-full animate-pulse" />
            <span className="text-sm text-muted-foreground">
              Recording... {Math.floor(recTime / 60)}:{String(recTime % 60).padStart(2, '0')}
            </span>
          </div>
          <button onClick={stopRecording} className="w-10 h-10 rounded-full bg-destructive flex items-center justify-center text-white">
            <Square className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background border-t-2 border-foreground">
    {/* Context bar. Only one of these can be active — you cannot reply and edit
        at the same time — so they share the slot rather than stacking. */}
    {(replyTo || editing) && (
      <div className="max-w-3xl mx-auto w-full px-3 pt-2">
        <div className="flex items-center gap-2 bg-secondary border-2 border-foreground rounded-xl px-3 py-2">
          {editing ? (
            <Pencil className="w-4 h-4 text-primary shrink-0" />
          ) : (
            <Reply className="w-4 h-4 text-primary shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-primary leading-tight">
              {editing ? 'Editing message' : `Replying to ${replyTo.senderName}`}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {editing ? editing.content : replyTo.preview}
            </p>
          </div>
          <button
            onClick={editing ? onCancelEdit : onCancelReply}
            aria-label={editing ? 'Cancel edit' : 'Cancel reply'}
            className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-background transition shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    )}
    <div className="flex items-end gap-2 px-3 py-3 max-w-3xl mx-auto w-full">
      <input ref={fileInputRef} type="file" accept="image/*,video/*,application/pdf,.doc,.docx,.txt,.zip" onChange={handleFileSelect} className="hidden" />
      <button
        onClick={() => fileInputRef.current?.click()}
        // Editing changes the text of a message that already exists. Attaching
        // a file to it is not a thing this supports, so the button goes away
        // rather than doing something surprising.
        disabled={uploading || disabled || Boolean(editing)}
        className="w-10 h-10 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition shrink-0"
      >
        {uploading ? <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" /> : <Paperclip className="w-5 h-5" />}
      </button>
      <div className="flex-1 flex items-end gap-2 bg-secondary rounded-2xl px-3.5 py-2 border-2 border-foreground">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            // Editing an existing message is not "typing" to anyone else — the
            // message is already sent, and announcing it would be misleading.
            if (!editing && e.target.value) onTyping?.();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
            // Escape backs out of reply or edit — the expected way out of a
            // mode, and quicker than aiming at the small X.
            if (e.key === 'Escape') {
              if (editing) onCancelEdit?.();
              else if (replyTo) onCancelReply?.();
            }
          }}
          placeholder={editing ? 'Edit your message...' : 'Type a message...'}
          rows={1}
          disabled={disabled}
          className="flex-1 bg-transparent resize-none outline-none text-sm text-foreground placeholder:text-muted-foreground max-h-24"
          style={{ minHeight: '20px' }}
        />
      </div>
      {/* While editing the mic is never the right control, even with the box
          momentarily empty — a voice note cannot replace a text message. */}
      {text.trim() || editing ? (
        <button
          onClick={handleSend}
          disabled={disabled || !text.trim()}
          className="w-10 h-10 rounded-full gradient-bg flex items-center justify-center shrink-0 shadow-pop-sm hover:-translate-y-0.5 transition"
        >
          <Send className="w-4 h-4" />
        </button>
      ) : (
        <button
          onClick={startRecording}
          disabled={uploading || disabled}
          className="w-10 h-10 rounded-full bg-secondary border-2 border-foreground flex items-center justify-center text-foreground shrink-0 shadow-pop-sm hover:-translate-y-0.5 transition"
        >
          <Mic className="w-5 h-5" />
        </button>
      )}
    </div>
    </div>
  );
}