'use client';

import { createClient } from '@/lib/supabase/client';
import type { UploadBucket } from '@/lib/storage-paths';

export type { UploadBucket };

interface UploadTarget {
  provider: 'r2' | 'supabase';
  path: string;
  /** Presigned PUT, on R2. */
  url?: string;
  error?: string;
}

/**
 * Uploads straight from the browser to a private bucket, under
 * <schoolId>/<prefix>..., so the upload skips the Server Action body limit. The
 * server names the object and picks the provider. On R2 it signs a PUT for this
 * exact type and size; on Supabase, storage RLS decides. Returns the object
 * path for the caller to hand to a Server Action.
 */
export async function uploadToBucket(
  bucket: UploadBucket,
  schoolId: string,
  prefix: string,
  file: File,
): Promise<string> {
  const response = await fetch('/api/storage/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucket, schoolId, prefix, name: file.name, type: file.type, size: file.size }),
  });
  const target = (await response.json().catch(() => ({}))) as UploadTarget;
  if (!response.ok) throw new Error(target.error ?? 'Could not start the upload.');

  if (target.provider === 'r2' && target.url) {
    const put = await fetch(target.url, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
    if (!put.ok) throw new Error('The upload failed. Please try again.');
    return target.path;
  }

  const { error } = await createClient()
    .storage.from(bucket)
    .upload(target.path, file, { contentType: file.type, upsert: false, cacheControl: '3600' });
  if (error) throw new Error(error.message);
  return target.path;
}
