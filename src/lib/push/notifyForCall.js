import 'server-only';

import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { sendPushToAccounts } from '@/lib/push/server';

/**
 * Tells the other person their phone is ringing.
 *
 * WHY THIS EXISTS. `watchForCalls` only listens on the conversation you have
 * open, because listening everywhere means holding one Realtime channel per
 * conversation open permanently. So a call to someone sitting on their contacts
 * list — or with the app closed — used to be completely silent: no ring, no
 * notification, no record anywhere. FOLLOWUPS §1.
 *
 * A CALL NOTIFICATION IS NOT A MESSAGE NOTIFICATION, in three ways that matter:
 *
 *   - It expires. A message is still worth reading an hour later; a ring is
 *     worthless once the caller has given up, so it carries a TTL just past the
 *     45s ring timeout and the push service drops it rather than delivering a
 *     notification for a call that ended long ago.
 *   - It is urgent. `urgency: 'high'` asks the push service not to batch it,
 *     which is the difference between ringing now and ringing in a minute.
 *   - It survives a preview preference. Hiding message previews is about not
 *     showing your words on a lock screen — it is not a reason to hide that
 *     somebody is calling, so `hide_notification_preview` does not apply here.
 *     A caller's name is what makes the notification worth tapping.
 *
 * MUTES AND BLOCKS STILL APPLY. Muting a conversation is a statement about
 * being disturbed by it, and blocking someone should stop them making your
 * phone buzz — which is most of what blocking is for.
 *
 * CALLERS MUST HAVE ESTABLISHED MEMBERSHIP ALREADY, exactly as with
 * notifyForMessage: this uses the service role and re-checks nothing.
 *
 * @param {object} conversation  id, type, participant_ids
 * @param {string} callerId
 * @param {boolean} video
 */

// Just past RING_TIMEOUT_MS in lib/calls/controller.js. Past it, not equal to
// it, so a notification in flight when the caller gives up still lands rather
// than being dropped a second before arriving.
const CALL_TTL_SECONDS = 50;

export async function notifyForCall({ conversation, callerId, video = false }) {
  const empty = { sent: 0, failed: 0, pruned: 0 };

  // Group calls are not a thing yet — the button is hidden for them — so a ring
  // with more than one recipient means something has gone wrong upstream.
  const recipients = (conversation.participant_ids || []).filter((id) => id && id !== callerId);
  if (recipients.length === 0) return { ...empty, reason: 'no-recipients' };

  const admin = getSupabaseAdminClient();

  const [{ data: accounts }, { data: mutes }] = await Promise.all([
    admin
      .from('accounts')
      .select('id, username, display_name, blocked_account_ids')
      .in('id', [callerId, ...recipients]),
    admin
      .from('conversation_mutes')
      .select('account_id, muted_until')
      .eq('conversation_id', conversation.id)
      .in('account_id', recipients),
  ]);

  const caller = accounts?.find((a) => a.id === callerId);
  const callerName = caller?.display_name || caller?.username || 'Someone';

  const mutedIds = new Set(
    (mutes || [])
      .filter((m) => !m.muted_until || new Date(m.muted_until) > new Date())
      .map((m) => m.account_id)
  );

  const allowed = recipients.filter((id) => {
    const account = accounts?.find((a) => a.id === id);
    if (account?.blocked_account_ids?.includes(callerId)) return false;
    return !mutedIds.has(id);
  });

  if (allowed.length === 0) return { ...empty, reason: 'no-recipients' };

  return sendPushToAccounts(
    allowed,
    {
      kind: 'call',
      title: callerName,
      body: video ? 'Incoming video call' : 'Incoming call',
      conversationId: conversation.id,
      url: `/chat/${conversation.id}`,
      timestamp: Date.now(),
    },
    { ttl: CALL_TTL_SECONDS, urgency: 'high' }
  );
}
