'use client';

import { createClient } from '@/lib/supabase/client';

export type UploadBucket = 'avatars' | 'academic-docs';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').slice(-80);
}

/**
 * Uploads straight from the browser to a private bucket, under
 * <schoolId>/<prefix>..., so the upload skips the Server Action body limit and
 * storage RLS decides whether the signed-in user may write there. Returns the
 * object path for the caller to hand to a Server Action.
 */
export async function uploadToBucket(
  bucket: UploadBucket,
  schoolId: string,
  prefix: string,
  file: File,
): Promise<string> {
  const extension = EXTENSIONS[file.type] ?? file.name.split('.').pop() ?? 'bin';
  const stamp = Date.now().toString(36);
  const path =
    bucket === 'avatars'
      ? `${schoolId}/${prefix}-${stamp}.${extension}`
      : `${schoolId}/${prefix}/${stamp}-${safeName(file.name)}`;

  const { error } = await createClient()
    .storage.from(bucket)
    .upload(path, file, { contentType: file.type, upsert: false, cacheControl: '3600' });

  if (error) throw new Error(error.message);
  return path;
}
