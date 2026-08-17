import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { jsonError } from '@/lib/auth/shared';
import { MEDIA_BUCKET } from '@/lib/media/keys';

/**
 * POST /api/cron/sweep-media
 *
 * Deletes the attachments belonging to messages that have already expired.
 *
 * The database half of this lives in 0010_expiry_sweep.sql: a pg_cron job
 * deletes expired message rows every five minutes and queues their storage
 * keys in `expired_media`. It cannot delete the objects themselves — removing
 * bytes from Supabase Storage needs the Storage API, and giving Postgres a
 * service-role key so it could call one is a worse thing to own than the
 * problem it solves. So this drains the queue.
 *
 * Nothing is reachable in the meantime: with the message row gone there is no
 * RLS grant, so /api/media/sign will not sign the key for anybody.
 *
 * AUTHENTICATION is a shared secret, not a session, because the caller is a
 * scheduler rather than a person. Set CRON_SECRET and send it as
 * `Authorization: Bearer <secret>`. With no secret configured the route refuses
 * every request rather than defaulting to open — an unauthenticated endpoint
 * that deletes files is not a thing to ship by accident.
 */

// Storage rejects very large delete batches, and a run that does 200 keys every
// five minutes clears a backlog of thousands within the hour.
const BATCH = 200;

export async function POST(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return jsonError('Cron is not configured.', 503);

  const provided = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');

  // Length-independent comparison is overkill for a header nobody can time
  // remotely, but it costs one line.
  if (!provided || provided !== secret) return jsonError('Not authorised.', 401);

  const admin = getSupabaseAdminClient();

  const { data: queued, error: readErr } = await admin
    .from('expired_media')
    .select('id, storage_key, attempts')
    .order('queued_at', { ascending: true })
    .limit(BATCH);

  if (readErr) return jsonError('Could not read the queue.', 502);
  if (!queued?.length) return Response.json({ ok: true, deleted: 0, remaining: 0 });

  const keys = queued.map((row) => row.storage_key);
  const { error: removeErr } = await admin.storage.from(MEDIA_BUCKET).remove(keys);

  if (removeErr) {
    // Leave the rows queued and record why. A key that keeps failing shows up
    // as a climbing `attempts` rather than vanishing quietly.
    await admin
      .from('expired_media')
      .update({ attempts: (queued[0]?.attempts ?? 0) + 1, last_error: removeErr.message.slice(0, 400) })
      .in('id', queued.map((row) => row.id));

    return jsonError('Could not delete those objects.', 502);
  }

  // remove() succeeds for keys that no longer exist, which is what we want:
  // an object deleted by some other path should still leave the queue.
  const { error: clearErr } = await admin
    .from('expired_media')
    .delete()
    .in('id', queued.map((row) => row.id));

  if (clearErr) {
    // The files are gone but the queue rows are not. Next run will try to
    // delete them again, which is harmless — hence reporting success.
    return Response.json({ ok: true, deleted: keys.length, warning: 'queue not cleared' });
  }

  const { count } = await admin
    .from('expired_media')
    .select('id', { count: 'exact', head: true });

  return Response.json({ ok: true, deleted: keys.length, remaining: count ?? 0 });
}

/**
 * Vercel Cron calls this with GET, not POST.
 *
 * It also sends `Authorization: Bearer $CRON_SECRET` of its own accord when
 * that variable is set on the project, which is exactly the check POST already
 * makes — so the two conventions line up and this is a delegation rather than a
 * second implementation.
 *
 * Without this the nightly job would 405 every time, and the only visible
 * symptom would be storage quietly filling up with objects belonging to deleted
 * messages. Kept as a separate export rather than loosening the method check,
 * because "any method may delete files" is not the same promise.
 */
export const GET = POST;
