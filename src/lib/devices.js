'use client';

import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * The signed-in device list (0018).
 *
 * These are real GoTrue sessions, not a table of our own describing them — see
 * the migration for why. Both calls go through SECURITY DEFINER functions
 * because `auth.sessions` is not, and should not be, readable by clients.
 */

/**
 * Turns a user-agent string into something a person can recognise in a list.
 *
 * Deliberately coarse. The job is "which of these is my phone" — not accurate
 * device detection, which is unwinnable and which nobody is asking for. An
 * unparseable agent keeps its first chunk rather than being labelled "Unknown",
 * because a truncated real string is more use for picking the odd one out.
 */
export function describeDevice(userAgent) {
  if (!userAgent) return 'Unknown device';

  const ua = userAgent;
  const os =
    /iPhone|iPad|iPod/i.test(ua) ? 'iPhone/iPad'
    : /Android/i.test(ua) ? 'Android'
    : /Windows/i.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/i.test(ua) ? 'Mac'
    : /Linux/i.test(ua) ? 'Linux'
    : null;

  // Order matters: Edge and Opera both claim Chrome, and Chrome claims Safari.
  const browser =
    /Edg\//i.test(ua) ? 'Edge'
    : /OPR\/|Opera/i.test(ua) ? 'Opera'
    : /Firefox\//i.test(ua) ? 'Firefox'
    : /Chrome\//i.test(ua) ? 'Chrome'
    : /Safari\//i.test(ua) ? 'Safari'
    : null;

  if (os && browser) return `${browser} on ${os}`;
  if (os) return os;
  if (browser) return browser;
  return ua.slice(0, 40);
}

/**
 * @returns {Promise<Array<{id, created_at, last_seen_at, user_agent, ip, is_current}>>}
 */
export async function listDevices() {
  const { data, error } = await getSupabaseBrowserClient().rpc('list_my_devices');
  if (error) throw new Error(error.message);
  return data || [];
}

/** @returns {Promise<boolean>} false when the session had already gone. */
export async function revokeDevice(sessionId) {
  const { data, error } = await getSupabaseBrowserClient().rpc('revoke_my_device', {
    target_id: sessionId,
  });
  if (error) throw new Error(error.message);
  return Boolean(data);
}
