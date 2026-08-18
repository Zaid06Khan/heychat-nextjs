'use client';

import { useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { getIceConfig } from './ice';
import { startRinging, stopRinging } from '@/lib/sound';

/**
 * One-to-one calls, audio or video.
 *
 * A singleton rather than a hook, because a call outlives any screen. It has to
 * survive navigating from the conversation to Settings, and an incoming call has
 * to ring wherever you are — so the state lives here and components subscribe.
 * The same reasoning as `unread.js`, one step further because this owns
 * resources (a microphone, a peer connection, a socket) that a component
 * unmounting must not take with it.
 *
 * WHAT GOES OVER THE WIRE, AND WHAT DOES NOT. Signalling — an SDP offer, an
 * answer, ICE candidates — goes through a private Supabase Realtime channel
 * (0025). The media does NOT: once connected it flows directly between the two
 * browsers, and WebRTC mandates DTLS-SRTP, so a call is end-to-end encrypted
 * even though the messages in this app are not. Relayed calls are still
 * encrypted end-to-end; TURN forwards packets it cannot read.
 *
 * VIDEO IS DECIDED WHEN THE CALL STARTS, not during it. Turning a camera on
 * mid-call means renegotiating the peer connection, which needs glare handling
 * (both sides offering at once) to be safe. Within a video call the camera
 * toggles by disabling the track, which needs no renegotiation at all. The
 * upgrade path is noted in FOLLOWUPS §1 rather than half-built here.
 *
 * The previous CallOverlay called getUserMedia and rendered your own camera.
 * There was no peer connection, no signalling and no relay — two people "on a
 * call" each watched themselves. None of it is reused.
 */

const IDLE = { status: 'idle' };

let state = IDLE;
const subscribers = new Set();

let pc = null;            // RTCPeerConnection
let localStream = null;   // microphone
let channel = null;       // signalling
let channelTopic = null;  // which conversation `channel` is joined to
// True while a screen is holding the channel open to hear incoming calls. It
// decides whether ending a call may close the channel — see cleanup().
let watching = false;
let ringTimer = null;
// One retry of the offer, and the offer being retried. See sendOffer().
let offerRetryTimer = null;
let lastOffer = null;
// Candidates that arrive before setRemoteDescription cannot be added yet.
let pendingCandidates = [];

function publish(next) {
  state = next;
  for (const fn of subscribers) fn(state);
}

export function useCall() {
  const [value, setValue] = useState(state);
  useEffect(() => {
    setValue(state);
    subscribers.add(setValue);
    return () => subscribers.delete(setValue);
  }, []);
  return value;
}

export function getCallState() {
  return state;
}

/** Unanswered calls stop ringing rather than ringing forever. */
const RING_TIMEOUT_MS = 45000;

function send(type, payload = {}) {
  if (!channel) return;
  channel.send({
    type: 'broadcast',
    event: 'signal',
    payload: { type, from: state.meId, ...payload },
  });
}

/**
 * Tear everything down. Called on hangup, decline, failure and unmount.
 *
 * Stopping the microphone tracks is the part that matters most: without it the
 * browser's recording indicator stays on after the call, which reads as the app
 * still listening — and on that suspicion alone people uninstall.
 */
function cleanup() {
  stopRinging();
  clearTimeout(ringTimer);
  ringTimer = null;
  clearTimeout(offerRetryTimer);
  offerRetryTimer = null;
  lastOffer = null;
  pendingCandidates = [];

  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  // The remote stream needs no cleanup here: its tracks belong to the other
  // side and end with the peer connection, and every path out of a call
  // publishes a fresh state object that simply does not carry it.
  if (pc) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    try { pc.close(); } catch { /* already closed */ }
    pc = null;
  }
  // THE CHANNEL IS NOT THE CALL'S TO CLOSE while a screen is listening on it.
  //
  // This used to remove it unconditionally, and that broke the second call
  // every time: the receiver's channel was opened by watchForCalls when they
  // entered the conversation, ending the first call tore it down, and the
  // effect that opened it only re-runs when the conversation changes — so
  // nothing ever re-opened it. The first call worked; every call after it rang
  // out against a channel nobody was listening on.
  if (channel && !watching) {
    const supabase = getSupabaseBrowserClient();
    supabase.removeChannel(channel);
    channel = null;
    channelTopic = null;
  }
}

/**
 * Back to idle, keeping the context a listening screen still needs.
 *
 * Publishing a bare { status: 'idle' } dropped meId, conversationId and
 * peerName — so the next incoming call rang as "Someone" and had no id to
 * answer from. Ending a call is not the same as leaving the conversation.
 */
function backToIdle() {
  publish(
    watching
      ? {
          status: 'idle',
          conversationId: state.conversationId,
          meId: state.meId,
          peerName: state.peerName,
        }
      : IDLE
  );
}

/**
 * Ask for the tracks this call needs.
 *
 * AN AUDIO CALL NEVER ASKS FOR THE CAMERA. Requesting a device the app will not
 * use is the permission prompt people refuse, and refusing it once is sticky.
 *
 * A video call that cannot get a camera becomes an AUDIO call rather than no
 * call at all — a laptop with a broken webcam, or a camera another app already
 * holds, should not mean you cannot talk. The caller is told which one they got
 * so the UI can say so instead of showing a black rectangle.
 *
 * @returns {Promise<{ stream: MediaStream, video: boolean }>}
 */
async function getMedia(wantVideo) {
  if (!wantVideo) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    return { stream, video: false };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      // `ideal`, not `exact`: a device that cannot do 720p should give its best
      // rather than throw, which `exact` would.
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    return { stream, video: true };
  } catch {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    return { stream, video: false };
  }
}

function attachRemoteAudio(stream) {
  // Created rather than rendered, because the element must survive navigation.
  // A <audio> inside a component stops playing the moment that screen unmounts,
  // which for a call means the other person goes silent when you check Settings.
  // The id keeps the old spelling deliberately — it is a private DOM handle,
  // not a label, and the SQL policy names in 0025 cannot be changed at all
  // without breaking that migration's checksum.
  let el = document.getElementById('calamuse-remote-audio');
  if (!el) {
    el = document.createElement('audio');
    el.id = 'calamuse-remote-audio';
    el.autoplay = true;
    document.body.appendChild(el);
  }
  el.srcObject = stream;
  el.play().catch(() => {
    // Autoplay policy. The accept button is a gesture, so this normally
    // succeeds; if it does not, the call is connected and silent, which the UI
    // reports rather than hides.
  });
}

function newPeerConnection() {
  const peer = new RTCPeerConnection(getIceConfig());

  peer.onicecandidate = (e) => {
    if (e.candidate) send('ice', { candidate: e.candidate.toJSON() });
  };

  peer.ontrack = (e) => {
    const stream = e.streams[0] || new MediaStream([e.track]);
    // Audio always goes to the detached element, even on a video call, so that
    // the other person keeps talking while you navigate away from the stage.
    // The visible <video> is muted for exactly this reason.
    attachRemoteAudio(stream);

    // PUBLISH EVERY TIME, NOT ONLY FOR A NEW STREAM. `ontrack` fires once per
    // track and both tracks arrive on the SAME stream object, so guarding on
    // identity meant the video track's arrival published nothing at all: React
    // never re-rendered, and the stage kept showing the placeholder it had
    // drawn when only the audio track existed. The call carried video the
    // whole time and looked, to both people, like an audio call.
    publish({
      ...state,
      remoteStream: stream,
      remoteHasVideo: stream.getVideoTracks().length > 0,
    });
  };

  peer.onconnectionstatechange = () => {
    if (!pc) return;
    if (peer.connectionState === 'connected') {
      publish({ ...state, status: 'connected', since: Date.now() });
      // The opening statement of camera state. Whoever answered may have no
      // camera at all, and the other side has no way to know that from the SDP
      // alone in time to draw the first frame.
      send('camera', { on: Boolean(state.cameraOn) });
    }
    // `failed` is terminal — usually no route without a relay. `disconnected`
    // is often transient and recovers, so it is deliberately not treated as an
    // ending.
    if (peer.connectionState === 'failed') {
      endCall('failed');
    }
  };

  return peer;
}

/**
 * Join the signalling channel for a conversation, at most once.
 *
 * The guard is load-bearing, not defensive tidiness. `watchForCalls` opens this
 * when you enter a conversation, and `startCall` needs it too — without the
 * check the second call subscribed a SECOND channel to the same topic and
 * overwrote the reference, leaking the first. Both then delivered every signal,
 * so the caller applied the answer twice and the second attempt threw
 * `setRemoteDescription ... Called in wrong state: stable`. The call still
 * connected, which is exactly what made it easy to miss.
 */
async function openChannel(conversationId, meId) {
  if (channel && channelTopic === `call:${conversationId}`) return channel;

  const supabase = getSupabaseBrowserClient();

  // The socket needs this user's token before Realtime can authorise a private
  // channel — the same ordering rule that silently broke ConversationList.
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (token) {
    try { await supabase.realtime.setAuth(token); } catch { /* older client */ }
  }

  const topic = `call:${conversationId}`;
  const ch = supabase.channel(topic, {
    config: { private: true, broadcast: { self: false } },
  });
  ch.on('broadcast', { event: 'signal' }, ({ payload }) => onSignal(payload, meId));
  await ch.subscribe();
  channelTopic = topic;
  return ch;
}

/**
 * Send the offer, and send it once more if nobody acknowledges it.
 *
 * A BROADCAST THAT ARRIVES BEFORE YOU SUBSCRIBE IS GONE. Realtime does not
 * replay, so an offer sent in the window between the other person opening the
 * conversation and their channel finishing its subscribe is lost in silence:
 * their phone never rings, yours rings out, and nothing anywhere reports an
 * error. Found while screenshotting a video call — the caller's stage said
 * "Ringing…" against a callee who had no idea.
 *
 * The fix is an acknowledgement rather than a longer timeout. The callee sends
 * `ringing` the moment it starts ringing; if that has not arrived in two
 * seconds the offer goes again, once. A duplicate offer is harmless because
 * onSignal treats a repeat of the offer it is already ringing on as another
 * chance to acknowledge, not as a second call.
 */
function sendOffer(sdp, video) {
  lastOffer = { sdp, video };
  send('offer', { sdp, video });

  clearTimeout(offerRetryTimer);
  offerRetryTimer = setTimeout(() => {
    if (state.status !== 'calling' || !lastOffer) return;
    send('offer', { sdp: lastOffer.sdp, video: lastOffer.video, retry: true });
  }, 2000);
}

/** Start an outgoing call. `video: true` makes it a video call. */
export async function startCall({ conversationId, meId, peerName, video = false }) {
  if (state.status !== 'idle') return;

  publish({ status: 'calling', conversationId, meId, peerName, outgoing: true, video });

  let gotVideo = false;
  try {
    const media = await getMedia(video);
    localStream = media.stream;
    gotVideo = media.video;
  } catch {
    publish({ status: 'error', reason: 'no-microphone', peerName });
    return;
  }

  // `video` is what was asked for; `gotVideo` is what the device gave.
  //
  // THE CALL STAYS A VIDEO CALL EVEN WHEN THIS CAMERA FAILED. Setting
  // `video: gotVideo` here dropped the whole call back to the audio bar, so a
  // camera that would not open meant you could not SEE THE OTHER PERSON
  // either — their video was arriving and nothing rendered it. What a missing
  // camera costs is your own picture, and nothing else.
  publish({
    ...state,
    video,
    cameraOn: gotVideo,
    cameraAvailable: gotVideo,
    localStream,
  });

  try {
    channel = await openChannel(conversationId, meId);
    pc = newPeerConnection();
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

    // THE OFFER DECIDES WHAT THE CALL CAN CARRY. An answer cannot introduce a
    // media kind the offer never mentioned, so with no camera here there would
    // be no video m-line, and the other person's camera would be unusable too
    // — one broken webcam turning a video call into an audio call for both.
    // `recvonly` says: I have nothing to send, but send me yours.
    if (video && !gotVideo) {
      pc.addTransceiver('video', { direction: 'recvonly' });
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    // The flag rides along so the other phone can say "Incoming video call"
    // before anyone has answered. The SDP knows too, but not until it is parsed.
    sendOffer(offer, video);
    // Ringback: your own phone telling you it is trying. Started only after the
    // offer is actually sent, so it never rings for a call that failed to leave.
    startRinging('outgoing');

    ringTimer = setTimeout(() => endCall('no-answer'), RING_TIMEOUT_MS);
  } catch {
    cleanup();
    publish({ status: 'error', reason: 'failed-to-start', peerName });
  }
}

/** Answer the call currently ringing. */
export async function acceptCall() {
  if (state.status !== 'ringing') return;
  stopRinging();
  clearTimeout(ringTimer);

  let gotVideo = false;
  try {
    const media = await getMedia(Boolean(state.video));
    localStream = media.stream;
    gotVideo = media.video;
  } catch {
    send('decline');
    cleanup();
    publish({ status: 'error', reason: 'no-microphone', peerName: state.peerName });
    return;
  }

  // ASYMMETRIC ON PURPOSE. `state.video` stays true if they called with video,
  // even when this side has no camera — they keep sending, we keep receiving,
  // and only `cameraOn` goes false. A call where one person is visible is worth
  // more than one that refuses to connect.
  publish({ ...state, cameraOn: gotVideo, cameraAvailable: gotVideo, localStream });

  try {
    pc = newPeerConnection();
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

    await pc.setRemoteDescription(new RTCSessionDescription(state.offer));
    // Candidates that arrived while the offer was still ringing. They cannot be
    // added before the remote description exists, so they were held.
    for (const c of pendingCandidates) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* stale */ }
    }
    pendingCandidates = [];

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    send('answer', { sdp: answer });

    publish({ ...state, status: 'connecting' });
  } catch {
    cleanup();
    publish({ status: 'error', reason: 'failed-to-answer', peerName: state.peerName });
  }
}

export function declineCall() {
  if (state.status !== 'ringing') return;
  send('decline');
  cleanup();
  backToIdle();
}

/** Hang up, or abandon an attempt. `reason` shapes what the UI says. */
export function endCall(reason = 'ended') {
  if (state.status === 'idle') return;
  send('hangup');
  cleanup();

  if (reason === 'ended') {
    backToIdle();
    return;
  }
  publish({ status: 'error', reason, peerName: state.peerName });
  // An error is a message, not a mode. It clears itself so the app does not sit
  // in a failed state nobody dismissed.
  setTimeout(() => {
    if (state.status === 'error') backToIdle();
  }, 6000);
}

export function toggleMute() {
  if (!localStream) return;
  const track = localStream.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  publish({ ...state, muted: !track.enabled });
}

/**
 * Turn your camera off and on inside a video call.
 *
 * `enabled = false` rather than stopping the track: a stopped track cannot be
 * restarted, and replacing it would mean renegotiating. Disabled, the sender
 * keeps its place in the SDP and transmits black — the other side sees the
 * stream go dark, which is what "camera off" should look like.
 */
export function toggleCamera() {
  if (!localStream) return;
  const track = localStream.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  // TELL THEM, because a disabled track still arrives — as black frames on a
  // live track. The receiver cannot tell that apart from a dark room or a
  // frozen stream, so without this, turning your camera off looks to the other
  // person exactly like the call breaking.
  send('camera', { on: track.enabled });
  publish({ ...state, cameraOn: track.enabled });
}

/**
 * Front camera to back camera and back again.
 *
 * `replaceTrack` swaps what a sender transmits WITHOUT renegotiating, which is
 * the only reason this is cheap enough to include. The old track is stopped
 * after the swap, not before — stopping first leaves a visible gap, and if
 * getUserMedia then fails there is nothing to fall back to.
 */
export async function switchCamera() {
  if (!pc || !localStream) return;
  const current = localStream.getVideoTracks()[0];
  if (!current) return;

  const facing = current.getSettings().facingMode === 'environment' ? 'user' : 'environment';

  let replacement;
  try {
    replacement = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing },
      audio: false,
    });
  } catch {
    return; // One camera, or it is busy. Staying put is the right failure.
  }

  const next = replacement.getVideoTracks()[0];
  const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
  if (!sender || !next) {
    replacement.getTracks().forEach((t) => t.stop());
    return;
  }

  try {
    await sender.replaceTrack(next);
  } catch {
    replacement.getTracks().forEach((t) => t.stop());
    return;
  }

  next.enabled = current.enabled;
  localStream.removeTrack(current);
  current.stop();
  localStream.addTrack(next);
  publish({ ...state, facing });
}

/** Whether this device has more than one camera, so the UI can hide a dead button. */
export async function hasMultipleCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return false;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput').length > 1;
  } catch {
    return false;
  }
}

/**
 * Incoming signalling.
 *
 * `broadcast: { self: false }` means our own messages never come back, so
 * everything arriving here is from the other party.
 */
async function onSignal(payload, meId) {
  if (!payload || payload.from === meId) return;

  switch (payload.type) {
    case 'offer': {
      // The retry landing on a call we are already ringing for. Acknowledge it
      // again — the first ack is what may have been lost — and otherwise leave
      // everything alone, or the ringtone restarts and a second timeout stacks.
      if (state.status === 'ringing') {
        send('ringing');
        return;
      }
      // Already busy: refuse rather than silently dropping it, so the caller
      // learns something instead of ringing out.
      if (state.status !== 'idle') {
        send('decline');
        return;
      }
      publish({
        status: 'ringing',
        conversationId: state.conversationId,
        meId,
        peerName: state.peerName,
        offer: payload.sdp,
        outgoing: false,
        video: Boolean(payload.video),
      });
      startRinging('incoming');
      // Tells the caller their offer landed. Without it they cannot tell a
      // phone that is ringing from one that never heard them.
      send('ringing');
      ringTimer = setTimeout(() => {
        if (state.status === 'ringing') declineCall();
      }, RING_TIMEOUT_MS);
      break;
    }

    case 'camera': {
      publish({ ...state, peerCameraOn: Boolean(payload.on) });
      break;
    }

    case 'ringing': {
      // Their phone is ringing, so the offer does not need repeating.
      clearTimeout(offerRetryTimer);
      offerRetryTimer = null;
      break;
    }

    case 'answer': {
      stopRinging();
      clearTimeout(offerRetryTimer);
      offerRetryTimer = null;
      // `stable` means an answer has already been applied. With the channel
      // guard above this should not happen; ignoring it costs nothing and an
      // uncaught throw in a signalling handler kills the rest of the call.
      if (!pc || pc.signalingState === 'stable') return;
      clearTimeout(ringTimer);
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      publish({ ...state, status: 'connecting' });
      break;
    }

    case 'ice': {
      if (!payload.candidate) return;
      // Before the remote description exists there is nothing to attach a
      // candidate to, so hold it. Dropping them here is a classic cause of
      // calls that connect on a fast network and fail on a slow one.
      if (!pc || !pc.remoteDescription) {
        pendingCandidates.push(payload.candidate);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } catch { /* a stale candidate is not an error worth surfacing */ }
      break;
    }

    case 'decline':
      cleanup();
      publish({ ...state, status: 'error', reason: 'declined' });
      setTimeout(() => { if (state.status === 'error') backToIdle(); }, 4000);
      break;

    case 'hangup':
      cleanup();
      backToIdle();
      break;

    default:
      break;
  }
}

/**
 * Listen for incoming calls in a conversation.
 *
 * Called by the app shell for the conversation on screen. A fuller design would
 * listen across every conversation at once; that means one channel per
 * conversation open permanently, which is a real cost, so this is scoped for
 * now and noted in FOLLOWUPS.
 */
export async function watchForCalls({ conversationId, meId, peerName }) {
  if (state.status !== 'idle') return () => {};
  if (channel && channelTopic === `call:${conversationId}`) return () => {};

  publish({ status: 'idle', conversationId, meId, peerName });
  watching = true;
  channel = await openChannel(conversationId, meId);

  return () => {
    watching = false;
    // Only if nothing is happening. Leaving a conversation mid-call must not
    // take the signalling with it, or hanging up never reaches the other side.
    if (state.status === 'idle' && channel) {
      const supabase = getSupabaseBrowserClient();
      supabase.removeChannel(channel);
      channel = null;
      channelTopic = null;
    }
  };
}
