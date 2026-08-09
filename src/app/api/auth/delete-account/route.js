import { getSupabaseRouteClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

/**
 * POST /api/auth/delete-account
 *
 * Deleting the auth user cascades through every table: accounts.id references
 * auth.users(id) ON DELETE CASCADE, and messages/contact_requests/calls/
 * reports/account_secrets all cascade from accounts.id. So one delete
 * removes everything, atomically, in the database.
 *
 * The old client-side version issued eight separate deletes from the browser and
 * left orphaned rows behind if any of them failed halfway through.
 */
export async function POST() {
  const supabase = await getSupabaseRouteClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData?.user) {
    return Response.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const userId = userData.user.id;

  // Group conversations the user created would otherwise be left orphaned:
  // admin_id is ON DELETE SET NULL so the row itself survives the cascade.
  const admin = getSupabaseAdminClient();
  await admin.from('conversations').delete().eq('admin_id', userId).eq('type', 'group');

  // Direct conversations where this user was one of the two participants.
  await admin
    .from('conversations')
    .delete()
    .eq('type', 'direct')
    .contains('participant_ids', [userId]);

  const { error } = await admin.auth.admin.deleteUser(userId);

  if (error) {
    return Response.json({ error: 'Could not delete account.' }, { status: 500 });
  }

  await supabase.auth.signOut();

  return Response.json({ ok: true });
}
