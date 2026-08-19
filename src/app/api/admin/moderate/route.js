import { getSupabaseRouteClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { jsonError } from '@/lib/auth/shared';
import { requireAdmin } from '@/lib/admin/guard';

/**
 * POST /api/admin/moderate  { report_id?, subject_id?, action, note? }
 *
 * Acting on a report. One route rather than four, because every action is the
 * same shape: decide, record why, and sometimes change what the subject can do.
 *
 * FOUR ACTIONS, AND THE DIFFERENCE MATTERS:
 *
 *   dismissed   nothing was wrong. Closes the report.
 *   reviewed    looked at, no action taken. Closes the report.
 *   suspended   the account loses access. Closes the report as `actioned`.
 *   unsuspended gives it back. Not tied to a report.
 *
 * WHAT SUSPENSION ACTUALLY DOES, because "banned" is usually vaguer than people
 * assume. It sets `suspended_at`, which the login route refuses a session for,
 * and it revokes every refresh token so no existing session can renew itself.
 * The access token already in a browser stays valid until it expires — an hour
 * by default. There is no way around that short of checking suspension on every
 * request, which would put a database read in front of every query in the app.
 * Saying so is better than implying the door slams instantly.
 *
 * EVERY ACTION IS WRITTEN TO `moderation_actions` BEFORE IT TAKES EFFECT, so a
 * suspension that fails halfway still leaves a record that it was attempted.
 */

const ACTIONS = new Set(['dismissed', 'reviewed', 'suspended', 'unsuspended']);

// How a report's status ends up, per action. `unsuspended` touches no report.
const REPORT_STATUS = {
  dismissed: 'dismissed',
  reviewed: 'reviewed',
  suspended: 'actioned',
};

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body.');
  }

  const supabase = await getSupabaseRouteClient(request);
  const guard = await requireAdmin(supabase);
  if (guard.error) return guard.error;

  const moderatorId = guard.userId;
  const { report_id: reportId = null, subject_id: subjectId = null, action, note = '' } = body ?? {};

  if (!ACTIONS.has(action)) return jsonError('Unknown action.');
  if (typeof note !== 'string' || note.length > 2000) return jsonError('Invalid note.');
  if (!reportId && !subjectId) return jsonError('A report_id or a subject_id is required.');

  const admin = getSupabaseAdminClient();

  // Resolve the subject from the report when one was not named, so the audit
  // row always says who this was about.
  let subject = subjectId;
  let report = null;
  if (reportId) {
    const { data } = await supabase
      .from('reports')
      .select('id, reported_id, status')
      .eq('id', reportId)
      .maybeSingle();
    if (!data) return jsonError('Report not found.', 404);
    report = data;
    subject = subject || data.reported_id;
  }

  if ((action === 'suspended' || action === 'unsuspended') && !subject) {
    return jsonError('That action needs an account to act on.');
  }

  // An admin suspending themselves would lock the only moderator out of the
  // queue, and there is no second admin to undo it.
  if (action === 'suspended' && subject === moderatorId) {
    return jsonError('You cannot suspend your own account.');
  }

  const { error: auditError } = await admin.from('moderation_actions').insert({
    report_id: reportId,
    moderator_id: moderatorId,
    subject_id: subject,
    action,
    note: note.trim() || null,
  });
  if (auditError) return jsonError(auditError.message, 500);

  if (action === 'suspended') {
    const { error } = await admin
      .from('accounts')
      .update({ suspended_at: new Date().toISOString(), suspended_reason: note.trim() || null })
      .eq('id', subject);
    if (error) return jsonError(error.message, 500);

    // Revoke refresh tokens so the session cannot renew itself. Best effort:
    // the suspension is recorded either way, and login already refuses.
    await admin.auth.admin.signOut(subject, 'global').catch(() => {});
  }

  if (action === 'unsuspended') {
    const { error } = await admin
      .from('accounts')
      .update({ suspended_at: null, suspended_reason: null })
      .eq('id', subject);
    if (error) return jsonError(error.message, 500);
  }

  if (report && REPORT_STATUS[action]) {
    // Through the caller's session, so `reports_update_admin` is what allows it
    // — the boundary already written and already tested, rather than a second
    // one here that could drift from it.
    const { error } = await supabase
      .from('reports')
      .update({ status: REPORT_STATUS[action], updated_date: new Date().toISOString() })
      .eq('id', report.id);
    if (error) return jsonError(error.message, 500);
  }

  return Response.json({ ok: true, action, subject_id: subject });
}
