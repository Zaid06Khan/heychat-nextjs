'use client';

import { useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { getIceConfig } from './ice';
import { startRinging, stopRinging } from '@/lib/sound';

/**
 * One-to-one calls. Audio for now; video is a later pass.
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
 * (0025). The audio does NOT: once connected it flows directly between the two
 * browsers, and WebRTC mandates DTLS-SRTP, so a call is end-to-end encrypted
 * even though the messages in this app are not. Relayed calls are still
 * encrypted end-to-end; TURN forwards packets it cannot read.
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
  pendingCandidates = [];

  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
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

async function getMicrophone() {
  // Audio only, deliberately: video is a later pass, and asking for a camera
  // the app will not use is the kind of permission prompt people refuse.
  return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
}

function attachRemoteAudio(stream) {
  // Created rather than rendered, because the element must survive navigation.
  // A <audio> inside a component stops playing the moment that screen unmounts,
  // which for a call means the other person goes silent when you check Settings.
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
    attachRemoteAudio(e.streams[0]);
  };

  peer.onconnectionstatechange = () => {
    if (!pc) return;
    if (peer.connectionState === 'connected') {
      publish({ ...state, status: 'connected', since: Date.now() });
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

/** Start an outgoing call. */
export async function startCall({ conversationId, meId, peerName }) {
  if (state.status !== 'idle') return;

  publish({ status: 'calling', conversationId, meId, peerName, outgoing: true });

  try {
    localStream = await getMicrophone();
  } catch {
    publish({ status: 'error', reason: 'no-microphone', peerName });
    return;
  }

  try {
    channel = await openChannel(conversationId, meId);
    pc = newPeerConnection();
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send('offer', { sdp: offer });
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

  try {
    localStream = await getMicrophone();
  } catch {
    send('decline');
    cleanup();
    publish({ status: 'error', reason: 'no-microphone', peerName: state.peerName });
    return;
  }

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
 * Incoming signalling.
 *
 * `broadcast: { self: false }` means our own messages never come back, so
 * everything arriving here is from the other party.
 */
async function onSignal(payload, meId) {
  if (!payload || payload.from === meId) return;

  switch (payload.type) {
    case 'offer': {
      // Already busy: refuse rather than silently dropping it, so the caller
      // learns something instead of ringing out.
      if (state.status !== 'idle' && state.status !== 'ringing') {
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
      });
      startRinging('incoming');
      ringTimer = setTimeout(() => {
        if (state.status === 'ringing') declineCall();
      }, RING_TIMEOUT_MS);
      break;
    }

    case 'answer': {
      stopRinging();
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
