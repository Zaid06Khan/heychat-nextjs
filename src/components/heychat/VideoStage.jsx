'use client';

import { useEffect, useRef, useState } from 'react';
import { PhoneOff, Mic, MicOff, Video, VideoOff, SwitchCamera } from 'lucide-react';
import {
  endCall,
  toggleMute,
  toggleCamera,
  switchCamera,
  hasMultipleCameras,
} from '@/lib/calls/controller';

/**
 * The screen for a video call: their face, your face, and the controls.
 *
 * MOUNTED FROM CallBar, WHICH LIVES IN AppLayout, for the same reason the audio
 * element is detached from any screen — a call outlives the conversation it
 * started in. Navigating to Settings mid-call must not end it.
 *
 * THE STREAMS ARE NOT OWNED HERE. The controller holds them and publishes them
 * on its state; this attaches whatever it is handed to a <video> via `srcObject`
 * and detaches on unmount. That indirection is what lets the surface come and go
 * without touching the peer connection.
 *
 * The remote <video> is MUTED, which looks wrong and is not: remote audio plays
 * through the detached element the controller owns, so it keeps going if this
 * component ever unmounts. Unmuting here would play everything twice.
 */

function elapsed(since) {
  const secs = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const m = String(Math.floor(secs / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${m}:${s}`;
}

/** Attaches a MediaStream to a video element, and lets go of it on unmount. */
function useStream(ref, stream) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    el.srcObject = stream || null;
    if (stream) {
      // Autoplay is allowed for muted video, but a rejected promise here is
      // still not a reason to throw inside an effect.
      el.play().catch(() => {});
    }
    return () => { el.srcObject = null; };
  }, [ref, stream]);
}

export default function VideoStage({ call }) {
  const remoteRef = useRef(null);
  const localRef = useRef(null);
  const [, tick] = useState(0);
  const [canSwitch, setCanSwitch] = useState(false);

  useStream(remoteRef, call.remoteStream);
  useStream(localRef, call.localStream);

  useEffect(() => {
    if (call.status !== 'connected') return undefined;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [call.status]);

  // Only offered where it can work. A phone has two cameras; a laptop usually
  // has one, and a button that silently does nothing is worse than no button.
  useEffect(() => {
    let alive = true;
    hasMultipleCameras().then((yes) => { if (alive) setCanSwitch(yes); });
    return () => { alive = false; };
  }, []);

  const who = call.peerName || 'Someone';
  // Two conditions, and the second is the one that matters. A track stays
  // `live` when the sender disables it — it just carries black — so the pixels
  // cannot tell you the camera is off. `peerCameraOn` is what they told us.
  const hasRemoteVideo =
    call.remoteStream && call.remoteStream.getVideoTracks().some((t) => t.readyState === 'live');
  const remoteVideoLive = hasRemoteVideo && call.peerCameraOn !== false;

  const label =
    call.status === 'connected'
      ? elapsed(call.since)
      : call.outgoing
        ? 'Ringing…'
        : 'Connecting…';

  return (
    <div className="fixed inset-0 z-[70] bg-foreground flex flex-col">
      {/* Theirs. object-cover so a portrait phone fills a landscape frame
          without letterboxing, which reads as a broken stream. */}
      <div className="relative flex-1 min-h-0">
        <video
          ref={remoteRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover ${remoteVideoLive ? '' : 'hidden'}`}
        />

        {!remoteVideoLive && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="w-20 h-20 rounded-full bg-background/10 border-2 border-background/30 flex items-center justify-center">
              <span className="text-3xl font-display font-extrabold text-background">
                {who.charAt(0).toUpperCase()}
              </span>
            </span>
            <p className="text-background font-bold">{who}</p>
            <p className="text-background/60 text-sm tabular-nums">
              {call.status === 'connected' ? 'Camera off' : label}
            </p>
          </div>
        )}

        {/* Name and duration, over the video. */}
        <div className="absolute top-0 inset-x-0 p-4 bg-gradient-to-b from-foreground/70 to-transparent">
          <p className="text-background font-bold truncate">{who}</p>
          <p className="text-background/70 text-xs tabular-nums">{label}</p>
        </div>

        {/* Yours, picture-in-picture. Mirrored, because a preview that is not
            mirrored feels like watching someone else. */}
        {call.cameraOn && call.localStream && (
          <div className="absolute bottom-4 right-4 w-28 sm:w-36 aspect-[3/4] rounded-2xl overflow-hidden border-2 border-background/70 shadow-pop">
            <video
              ref={localRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover -scale-x-100"
            />
          </div>
        )}
      </div>

      <div className="shrink-0 flex items-center justify-center gap-4 py-6 px-4 bg-foreground">
        <button
          onClick={toggleMute}
          aria-label={call.muted ? 'Unmute' : 'Mute'}
          className={`w-14 h-14 rounded-full border-2 border-background/40 flex items-center justify-center transition ${
            call.muted ? 'bg-background text-foreground' : 'bg-background/15 text-background'
          }`}
        >
          {call.muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </button>

        <button
          onClick={toggleCamera}
          aria-label={call.cameraOn ? 'Turn camera off' : 'Turn camera on'}
          className={`w-14 h-14 rounded-full border-2 border-background/40 flex items-center justify-center transition ${
            call.cameraOn ? 'bg-background/15 text-background' : 'bg-background text-foreground'
          }`}
        >
          {call.cameraOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
        </button>

        {canSwitch && call.cameraOn && (
          <button
            onClick={switchCamera}
            aria-label="Switch camera"
            className="w-14 h-14 rounded-full border-2 border-background/40 bg-background/15 text-background flex items-center justify-center transition"
          >
            <SwitchCamera className="w-5 h-5" />
          </button>
        )}

        <button
          onClick={() => endCall()}
          aria-label="Hang up"
          className="w-14 h-14 rounded-full bg-destructive text-destructive-foreground border-2 border-background/40 flex items-center justify-center transition"
        >
          <PhoneOff className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
