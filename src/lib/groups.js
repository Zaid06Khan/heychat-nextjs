'use client';

import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Group membership and details.
 *
 * Every one of these is an RPC rather than a table write, because none of them
 * are expressible as a row policy. "The admin may remove anyone except
 * themselves", "you may always remove yourself", "adding someone depends on
 * THEIR privacy setting" — those are rules about which columns change and under
 * what conditions, and RLS is row-level by construction.
 *
 * Since 0015 the client cannot write participant_ids, admin_id, name or
 * cover_image directly at all: the UPDATE grant is narrowed to
 * disappearing_timer. So these are not a convenience layer over table access,
 * they are the only way in.
 *
 * The errors are raised by Postgres with messages written to be shown to a
 * person ("only the group admin can add members"), so they are surfaced rather
 * than swallowed.
 */

const rpc = async (fn, args) => {
  const { data, error } = await getSupabaseBrowserClient().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
};

/**
 * Invite, not add.
 *
 * Until 0019 the admin put people straight into the group — no accept step, and
 * the block list was never consulted, so someone you had blocked could still
 * put you in a room with themselves. `group_add_member` is dropped; this asks,
 * and `respondToInvite` is how the answer comes back.
 */
export const inviteMember = (conversationId, accountId) =>
  rpc('group_invite_member', { conv_id: conversationId, invitee: accountId });

/** Pending invitations addressed to the signed-in account. */
export const myGroupInvites = () => rpc('my_group_invites');

/** @param {boolean} accept — declining is recorded, not just dropped. */
export const respondToInvite = (inviteId, accept) =>
  rpc('group_invite_respond', { invite_id: inviteId, accept });

export const removeMember = (conversationId, accountId) =>
  rpc('group_remove_member', { conv_id: conversationId, member: accountId });

/**
 * Leaving has two consequences decided server-side rather than here: if you are
 * the admin the longest-standing remaining member inherits it, and if you are
 * the last member the group is deleted. Both are in 0015.
 */
export const leaveGroup = (conversationId) =>
  rpc('group_leave', { conv_id: conversationId });

export const updateGroupDetails = (conversationId, { name = null, cover = null } = {}) =>
  rpc('group_update_details', { conv_id: conversationId, new_name: name, new_cover: cover });
