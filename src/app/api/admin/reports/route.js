import { getSupabaseRouteClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { jsonError } from '@/lib/auth/shared';
import { requireAdmin } from '@/lib/admin/guard';

/**
 * GET /api/admin/reports?status=pending
 *
 * The moderation queue. Reports have been written since 0001 and nothing has
 * ever read them — see 0027.
 *
 * WHY A ROUTE AND NOT A DIRECT QUERY. `reports_select_own` already lets an
 * admin read every report, so the browser could do this itself. It does not,
 * because the queue needs the reporter's and the reported account's usernames
 * alongside each row, and joining that in the client is three round trips and a
 * chance to forget one. The route reads reports through the CALLER's session,
 * so RLS is still the thing deciding what they may see.
 */
export async function GET(request) {
  const supabase = await getSupabaseRouteClient(request);
  const guard = await requireAdmin(supabase);
  if (guard.error) return guard.error;

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'pending';
  const VALID = new Set(['pending', 'reviewed', 'actioned', 'dismissed', 'all']);
  if (!VALID.has(status)) return jsonError('Unknown status.');

  let query = supabase
    .from('reports')
    .select('*')
    .order('created_date', { ascending: false })
    .limit(100);

  if (status !== 'all') query = query.eq('status', status);

  // Through the caller's session: a non-admin who got past the guard somehow
  // would still be handed only their own reports by RLS.
  const { data: reports, error } = await query;
  if (error) return jsonError(error.message, 500);

  const ids = [
    ...new Set(reports.flatMap((r) => [r.reporter_id, r.reported_id]).filter(Boolean)),
  ];

  // Service role for the names and suspension state. `accounts` is readable by
  // any signed-in user anyway, so nothing is exposed here that the moderator
  // could not already read — this only avoids depending on visibility rules
  // that might narrow later.
  const admin = getSupabaseAdminClient();
  const { data: people } = ids.length
    ? await admin
        .from('accounts')
        .select('id, username, display_name, suspended_at, suspended_reason')
        .in('id', ids)
    : { data: [] };

  const byId = new Map((people || []).map((p) => [p.id, p]));

  return Response.json({
    reports: reports.map((r) => ({
      ...r,
      reporter: byId.get(r.reporter_id) || null,
      reported: byId.get(r.reported_id) || null,
    })),
  });
}
