'use client';

import { getSupabaseBrowserClient } from '@/lib/supabase/client';

const BUCKET = 'media';

function extensionFor(file) {
  const fromName = file?.name?.includes('.') ? file.name.split('.').pop() : '';
  if (fromName && fromName.length <= 5) return fromName.toLowerCase();
  // Voice notes arrive as a Blob from MediaRecorder with no filename.
  const fromType = file?.type?.split('/')?.[1];
  return (fromType || 'bin').split(';')[0].toLowerCase();
}

/**
 * Drop-in replacement for Base44's `integrations.Core.UploadFile`.
 * Same call shape (`{ file }`), same return shape (`{ file_url }`).
 *
 * Objects are written to `<user-id>/<uuid>.<ext>`. The storage policy in
 * 0003_storage.sql keys off that first path segment, so a signed-in user can
 * only ever write into their own folder.
 */
export const Core = {
  async UploadFile({ file }) {
    if (!file) throw new Error('No file provided');

    const supabase = getSupabaseBrowserClient();

    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) throw new Error('You must be signed in to upload files.');

    const path = `${userData.user.id}/${crypto.randomUUID()}.${extensionFor(file)}`;

    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });

    if (error) throw new Error(error.message);

    const {
      data: { publicUrl },
    } = supabase.storage.from(BUCKET).getPublicUrl(path);

    return { file_url: publicUrl };
  },
};
