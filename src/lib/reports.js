'use client';

import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Reporting a user.
 *
 * Replaces `base44.entities.Report.create`. `reports_insert_reporter` is the
 * boundary — a report can only be filed as yourself — so nothing here checks
 * who the reporter is.
 *
 * WORTH KNOWING BEFORE LAUNCH: rows land here and nothing reads them. There is
 * no moderation queue and no review process, and both app stores expect one for
 * user-generated content. See FOLLOWUPS §9.
 */
export async function createReport({
  reporterId,
  reportedId,
  reportedUsername,
  reason,
  description,
}) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('reports')
    .insert({
      reporter_id: reporterId,
      reported_id: reportedId,
      reported_username: reportedUsername,
      reason,
      description,
      status: 'pending',
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}
