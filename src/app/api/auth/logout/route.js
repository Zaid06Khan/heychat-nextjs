import { getSupabaseRouteClient } from '@/lib/supabase/server';

/** POST /api/auth/logout — clears the session cookie and marks the user offline. */
export async function POST() {
  const supabase = await getSupabaseRouteClient();

  const { data } = await supabase.auth.getUser();

  if (data?.user) {
    await supabase
      .from('accounts')
      .update({ is_online: false, last_seen: new Date().toISOString() })
      .eq('id', data.user.id);
  }

  await supabase.auth.signOut();

  return Response.json({ ok: true });
}
