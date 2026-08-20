'use client';

import { useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { getIceConfig } from './ice';
import { startRinging, stopRinging } from '@/lib/sound';
import { recordCallOutcome } from './records';

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
// One in-flight openChannel, shared. See the comment on openChannel.
let channelOpening = null;
let channelOpeningTopic = null;
// Which watchForCalls call currently owns the listening channel. See below.
let watchToken = 0;
// One retry of the offer, and the offer being retried. See sendOffer().
let offerRetryTimer = null;
let lastOffer = null;
// Every ICE candidate this side has produced, kept so a late joiner can be
// given the ones it was not around to hear. See the `ring-request` handler.
let localCandidates = [];
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
/**
 * Leave a record of the call in the conversation.
 *
 * Called from cleanup, so every way a call can end runs through it: answered
 * and hung up, declined, rung out, or failed. Only the side that PLACED the
 * call writes — otherwise the same call appears twice in one thread, and a
 * declined call never reached the other side's UI to be recorded anyway.
 */
function recordEndedCall() {
  if (!state.outgoing || !state.conversationId || !state.meId) return;
  if (state.recorded) return;
  state.recorded = true;

  recordCallOutcome({
    conversationId: state.conversationId,
    initiatedBy: state.meId,
    // EVERYONE IN THE CONVERSATION, NOT JUST THIS SIDE. `calls_select_participant`
    // (0002) is `auth.uid() = any (participant_ids) or initiated_by = auth.uid()`,
    // so a row naming only the caller is a row the other person cannot read —
    // and the whole point of the record is the missed call THEY did not answer.
    // Written with only `[meId]` it left CallRecord's "Missed call" wording
    // unreachable, because the only reader was the one who placed the call.
    participantIds: state.participantIds?.length
      ? state.participantIds
      : [state.meId].filter(Boolean),
    connectedAt: state.since || null,
    video: Boolean(state.video),
  });
}

function cleanup() {
  recordEndedCall();
  stopRinging();
  clearTimeout(ringTimer);
  ringTimer = null;
  clearTimeout(offerRetryTimer);
  offerRetryTimer = null;
  lastOffer = null;
  localCandidates = [];
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
          peerAvatar: state.peerAvatar,
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
    if (!e.candidate) return;
    const candidate = e.candidate.toJSON();
    // Kept as well as sent. `onicecandidate` fires once per candidate and never
    // again, so anyone who subscribes after gathering has finished would
    // otherwise get the offer and no way to reach us.
    localCandidates.push(candidate);
    send('ice', { candidate });
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
      // `since` IS SET ONCE. connectionState reaches 'connected' again after
      // any ICE recovery — a phone moving between wifi and cellular does it
      // routinely — and re-stamping it there restarted the duration from
      // 00:00 mid-conversation.
      publish({
        ...state,
        status: 'connected',
        since: state.since || Date.now(),
      });
      // The opening statement of camera state. Whoever answered may have no
      // camera at all, and the other side has no way to know that from the SDP
      // alone in time to draw the first frame.
      send('camera', { on: Boolean(state.cameraOn) });
      send('mute', { muted: Boolean(state.muted) });
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
  const wanted = `call:${conversationId}`;
  if (channel && channelTopic === wanted) return channel;

  // CONCURRENT CALLERS MUST SHARE ONE JOIN, not race to create two channels.
  //
  // The guard above only helps once `channel` has been assigned, which is after
  // the join completes. `watchForCalls` runs on mount and `startCall` runs on a
  // click, so the two overlap routinely — and once joining became something
  // that takes time rather than returning immediately, that window was wide
  // enough to open a second channel on the same topic every time. supabase-js
  // refuses to subscribe the same topic twice, so calls stopped working
  // outright. Sharing the promise closes the window that the slow join opened.
  if (channelOpening && channelOpeningTopic === wanted) return channelOpening;

  channelOpeningTopic = wanted;
  channelOpening = joinChannel(conversationId, meId, wanted);
  try {
    return await channelOpening;
  } finally {
    channelOpening = null;
    channelOpeningTopic = null;
  }
}

async function joinChannel(conversationId, meId, topic) {
  const supabase = getSupabaseBrowserClient();

  // The socket needs this user's token before Realtime can authorise a private
  // channel — the same ordering rule that silently broke ConversationList.
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (token) {
    try { await supabase.realtime.setAuth(token); } catch { /* older client */ }
  }

  const ch = supabase.channel(topic, {
    config: { private: true, broadcast: { self: false } },
  });
  ch.on('broadcast', { event: 'signal' }, ({ payload }) => onSignal(payload, meId));

  // WAIT FOR THE JOIN, DO NOT JUST AWAIT subscribe().
  //
  // `subscribe()` returns the channel, not a promise, so `await` on it resolves
  // on the next tick with the join still in flight — and a broadcast sent to a
  // channel that has not joined is dropped on the floor, silently. The offer
  // survived that only because sendOffer retries after two seconds;
  // `ring-request` had no retry and vanished every time, so opening a
  // conversation never surfaced the call that was already ringing in it.
  await new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    // Never hang. A channel that cannot join should fail the call rather than
    // freeze the screen that opened it.
    const timer = setTimeout(done, 5000);
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer);
        done();
      }
    });
  });

  channelTopic = topic;
  // Assigned here as well as by the caller, so the fast path above sees it the
  // moment the join lands rather than one await later.
  channel = ch;
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

/**
 * Ask the server to push a ring to the other person.
 *
 * Fire-and-forget by design. This is the path that reaches a closed app; the
 * Realtime offer is the path that reaches an open one, and neither waits for
 * the other. A failure here is silent because there is nothing the caller could
 * do about it and the call may well connect anyway.
 */
function ringByPush(conversationId, video) {
  try {
    fetch('/api/calls/ring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: conversationId, video: Boolean(video) }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* offline, or fetch unavailable */
  }
}

/** Start an outgoing call. `video: true` makes it a video call. */
export async function startCall({
  conversationId,
  meId,
  peerName,
  peerAvatar = '',
  video = false,
  // Who the record of this call must name. Carried from the caller's screen
  // because the controller never loads the conversation itself — see
  // recordEndedCall() for what goes wrong when this is only `[meId]`.
  participantIds = [],
}) {
  if (state.status !== 'idle') return;

  publish({
    status: 'calling',
    conversationId,
    meId,
    peerName,
    peerAvatar,
    outgoing: true,
    video,
    participantIds,
  });

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

    // AND THE OTHER HALF: a push, for the far more common case where they are
    // not sitting in this conversation. The Realtime offer above only reaches
    // somebody whose channel is open. Deliberately not awaited — the ringback
    // should start now, and a push that fails must not fail the call.
    ringByPush(conversationId, video);
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
  // SAY SO. A muted mic is indistinguishable from a quiet room or a broken
  // connection at the other end — people say "hello? are you there?" at each
  // other for a while before working it out.
  send('mute', { muted: !track.enabled });
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
        peerAvatar: state.peerAvatar,
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

    case 'ring-request': {
      // Somebody just opened this conversation and is asking whether anything
      // is ringing. THIS IS WHAT MAKES THE NOTIFICATION WORK: they were not
      // subscribed when the offer went out, and Realtime never replays a
      // broadcast, so without an answer here tapping the notification would
      // land them in a silent chat while the caller sat listening to ringback.
      //
      // Only a caller still waiting replies, so this costs nothing the rest of
      // the time — and it is also a second safety net for the subscribe race
      // the retry in sendOffer covers.
      if (state.status === 'calling' && lastOffer) {
        send('offer', { sdp: lastOffer.sdp, video: lastOffer.video, retry: true });

        // AND THE CANDIDATES, which is the part that is easy to miss. By the
        // time somebody taps a notification, this side has finished gathering
        // and `onicecandidate` will never fire again — so re-sending only the
        // offer leaves them holding an SDP with no route back to us. On one
        // machine ICE can still limp to a connection from their candidates
        // alone, which is exactly why this failed intermittently rather than
        // always, and would fail far more often across real networks.
        for (const candidate of localCandidates) send('ice', { candidate });
      }
      break;
    }

    case 'camera': {
      publish({ ...state, peerCameraOn: Boolean(payload.on) });
      break;
    }

    case 'mute': {
      publish({ ...state, peerMuted: Boolean(payload.muted) });
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
export async function watchForCalls({ conversationId, meId, peerName, peerAvatar = '' }) {
  if (state.status !== 'idle') return () => {};

  /**
   * WHOEVER STARTED LAST OWNS THE CHANNEL, and only the owner may close it.
   *
   * ChatView's effect re-runs whenever `otherUser` resolves, so the second run
   * routinely overlaps the first. The old code guarded with "a channel for this
   * topic already exists, do nothing" and handed back a no-op cleanup — which
   * was survivable only while joining was instant. Once the join took real
   * time, the sequence became: run 1 joins slowly, React tears run 1 down, run
   * 2 sees the channel run 1 just created and returns a no-op, and then run 1's
   * late cleanup CLOSES the channel run 2 is relying on. The listener went
   * quiet and every call rang out against nobody.
   *
   * A token fixes it without reference counting: a cleanup that no longer owns
   * the watch does nothing at all.
   */
  const myToken = ++watchToken;

  publish({ status: 'idle', conversationId, meId, peerName, peerAvatar });
  watching = true;
  await openChannel(conversationId, meId);

  // Superseded while the join was in flight. The newer watcher owns the channel
  // now and will do its own asking.
  if (watchToken !== myToken) return () => {};

  // "Is anyone ringing?" Sent on every open, because the answer is free when
  // nobody is and it is the only way a call placed before this channel existed
  // can still be answered — which is exactly what happens when someone taps a
  // call notification.
  send('ring-request');

  return () => {
    if (watchToken !== myToken) return;
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
