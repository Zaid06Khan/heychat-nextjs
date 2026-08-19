import { after } from 'next/server';

import { getSupabaseRouteClient } from '@/lib/supabase/server';
import { jsonError } from '@/lib/auth/shared';
import { check, clientKey, tooManyRequests } from '@/lib/auth/rateLimit';
import { notifyForCall } from '@/lib/push/notifyForCall';

/**
 * POST /api/calls/ring  { conversation_id, video? }
 *
 * Makes the other person's phone ring when they are not in the conversation.
 *
 * The Realtime offer only reaches somebody whose `watchForCalls` channel is
 * open, which means the chat is on screen. This is the other half: a push, so a
 * call reaches a closed app. Nothing about the call itself goes through here —
 * the offer, the answer and the ICE candidates all stay on the private
 * signalling channel, and this route never sees any of them.
 *
 * WHY A ROUTE AND NOT THE BROWSER. The VAPID private key signs every push and
 * must never leave the server. Same shape as POST /api/messages.
 *
 * WHY after(). One HTTPS request per device to FCM/Mozilla/Apple, and none of it
 * should sit between pressing the call button and the ringback starting. The
 * caller's UI does not depend on the result, and a push that fails must not
 * fail the call — the Realtime path is still there and is the one that works
 * when they already have the chat open.
 *
 * MEMBERSHIP IS THE CALLER'S SESSION, not an argument. The conversation is read
 * through their own client, so `conversations_select_member` decides whether
 * they may ring it at all, and a non-member gets a 404 before any push is sent.
 * Without that this route would be an open "make this person's phone buzz"
 * endpoint for anyone who could guess a conversation id.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body.');
  }

  const supabase = await getSupabaseRouteClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return jsonError('Not signed in.', 401);

  const callerId = userData.user.id;

  // Tighter than messages, on purpose. Nobody legitimately places twenty calls
  // a minute, and a ring is the most disruptive notification the app can send.
  const rl = check(`ring:${callerId}:${clientKey(request)}`, 12, 60 * 1000);
  if (!rl.ok) return tooManyRequests(rl.retryAfter);

  const { conversation_id: conversationId, video = false } = body ?? {};
  if (typeof conversationId !== 'string' || !conversationId) {
    return jsonError('A conversation_id is required.');
  }

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, type, participant_ids')
    .eq('id', conversationId)
    .maybeSingle();

  if (!conversation) return jsonError('Not found.', 404);

  // Group calls need an SFU and the button is hidden for them, so a ring on a
  // group is not a thing that should ever be sent — refusing keeps this from
  // becoming a way to buzz everyone in a room at once.
  if (conversation.type === 'group') {
    return jsonError('Group calls are not supported.', 400);
  }

  after(async () => {
    try {
      await notifyForCall({ conversation, callerId, video: Boolean(video) });
    } catch {
      // A ring that could not be delivered is not an error the caller can do
      // anything about, and the call itself is unaffected.
    }
  });

  return Response.json({ ok: true });
}
