import { useEffect, useState } from 'react';
import { Phone, PhoneOff, Mic, MicOff, AlertTriangle, Video } from 'lucide-react';
import { useCall, acceptCall, declineCall, endCall, toggleMute } from '@/lib/calls/controller';
import { hasTurn } from '@/lib/calls/ice';
import VideoStage from './VideoStage';

/**
 * The call surface: ringing, connecting, connected, and what went wrong.
 *
 * Mounted in AppLayout rather than in ChatView, because a call outlives the
 * screen it started on — you must still be able to hang up after navigating to
 * Settings, and an incoming call must be answerable wherever you are.
 *
 * Renders nothing at all when idle, so it costs one subscription and no layout.
 *
 * A VIDEO CALL HANDS OVER TO VideoStage once it is under way. Ringing stays a
 * bar in both cases — a full-screen takeover for a call you have not accepted
 * is the behaviour people hate in other apps, and answering must not be the
 * only way out of it.
 */

const REASONS = {
  declined: 'Call declined',
  'no-answer': 'No answer',
  'no-microphone': 'Calamus3 could not use your microphone',
  'failed-to-start': 'Could not start the call',
  'failed-to-answer': 'Could not answer the call',
  failed: 'The call could not connect',
};

function elapsed(since) {
  const secs = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const m = String(Math.floor(secs / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export default function CallBar() {
  const call = useCall();
  const [, tick] = useState(0);

  // One timer, only while connected, only to redraw the duration.
  useEffect(() => {
    if (call.status !== 'connected') return undefined;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [call.status]);

  if (call.status === 'idle') return null;

  const who = call.peerName || 'Someone';

  // Everything past ringing, on a video call, belongs to the stage.
  if (call.video && ['calling', 'connecting', 'connected'].includes(call.status)) {
    return <VideoStage call={call} />;
  }

  if (call.status === 'error') {
    return (
      <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] w-[min(26rem,calc(100vw-1.5rem))]">
        <div className="flex items-start gap-2.5 bg-card border-2 border-destructive rounded-2xl shadow-pop px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground">
              {REASONS[call.reason] || 'Call ended'}
            </p>
            {/* Only said when it is the likely cause. A relay is exactly what
                fixes "could not connect", and saying so beats a shrug. */}
            {call.reason === 'failed' && !hasTurn() && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Some networks need a relay server to connect, and none is
                configured yet.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (call.status === 'ringing') {
    return (
      <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] w-[min(26rem,calc(100vw-1.5rem))]">
        <div className="flex items-center gap-3 bg-card border-2 border-foreground rounded-2xl shadow-pop px-4 py-3">
          <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent border-2 border-foreground">
            <Phone className="w-4 h-4 text-accent-foreground" />
            <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-60 animate-ping" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground truncate">{who}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              {call.video && <Video className="w-3 h-3 shrink-0" />}
              {call.video ? 'Incoming video call' : 'Incoming call'}
            </p>
          </div>
          <button
            onClick={declineCall}
            aria-label="Decline call"
            className="w-9 h-9 rounded-full bg-destructive text-destructive-foreground border-2 border-foreground flex items-center justify-center shrink-0"
          >
            <PhoneOff className="w-4 h-4" />
          </button>
          <button
            onClick={acceptCall}
            aria-label="Accept call"
            className="w-9 h-9 rounded-full bg-accent text-accent-foreground border-2 border-foreground flex items-center justify-center shrink-0"
          >
            <Phone className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  const label =
    call.status === 'connected'
      ? elapsed(call.since)
      : call.outgoing
        ? 'Ringing…'
        : 'Connecting…';

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] w-[min(26rem,calc(100vw-1.5rem))]">
      <div className="flex items-center gap-3 bg-card border-2 border-foreground rounded-2xl shadow-pop px-4 py-3">
        <Phone className="w-4 h-4 text-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-foreground truncate">{who}</p>
          <p className="text-xs text-muted-foreground tabular-nums">{label}</p>
        </div>
        {call.status === 'connected' && (
          <button
            onClick={toggleMute}
            aria-label={call.muted ? 'Unmute' : 'Mute'}
            className={`w-9 h-9 rounded-full border-2 border-foreground flex items-center justify-center shrink-0 ${
              call.muted ? 'bg-destructive text-destructive-foreground' : 'bg-secondary text-foreground'
            }`}
          >
            {call.muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
        )}
        <button
          onClick={() => endCall()}
          aria-label="Hang up"
          className="w-9 h-9 rounded-full bg-destructive text-destructive-foreground border-2 border-foreground flex items-center justify-center shrink-0"
        >
          <PhoneOff className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
