import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export type PrivateBucket = 'avatars' | 'academic-docs';

const DEFAULT_TTL_SECONDS = 60 * 60;

/**
 * Signed URLs for objects in a private bucket, created through the caller's
 * own client so storage RLS decides what they may see. Missing or forbidden
 * paths are simply absent from the map.
 */
export async function signedUrls(
  supabase: SupabaseClient<Database>,
  bucket: PrivateBucket,
  paths: (string | null | undefined)[],
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((path): path is string => Boolean(path)))];
  const urls = new Map<string, string>();
  if (unique.length === 0) return urls;

  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(unique, ttlSeconds);
  if (error) {
    console.error('[storage] signing failed', { bucket, error: error.message });
    return urls;
  }

  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) urls.set(entry.path, entry.signedUrl);
  }
  return urls;
}

/** A tenant-scoped path, so the first folder is always the school id RLS checks. */
export function isTenantPath(path: string, schoolId: string): boolean {
  return path.startsWith(`${schoolId}/`) && !path.includes('..');
}
