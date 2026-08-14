'use client';

/**
 * Sending a message.
 *
 * The one write that no longer goes through the compatibility shim. It posts to
 * /api/messages, which inserts the row *and* sends the push in the same request
 * — see that route for why. Nothing else about the screen changes: the sender's
 * own realtime subscription delivers the new row the same way it always did, so
 * the returned message is there for callers that want it rather than because
 * rendering depends on it.
 *
 * Note what is NOT sent: no sender_id, no read_by, and no expiry_at. All three
 * are the server's to decide, and the disappearing timer especially — computing
 * it in the browser meant the browser could decline to.
 *
 * @param {{ conversationId: string, messageType?: string, content?: string,
 *           mediaUrl?: string, replyToId?: string|null }} input
 * @returns {Promise<object>} the stored message
 */
export async function sendMessage({
  conversationId,
  messageType = 'text',
  content = '',
  mediaUrl = '',
  replyToId = null,
}) {
  const res = await fetch('/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation_id: conversationId,
      message_type: messageType,
      content,
      media_url: mediaUrl,
      reply_to_id: replyToId,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not send that message.');
  return data.message;
}
