import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { createAdminClient } from '@/lib/supabase/admin';
import { getObject, objectExists, presignGet, presignPut, putObject, r2ConfigFromEnv, r2Key, removeObjects, type R2Config } from '@/lib/r2';
import { isTenantPath, type UploadBucket } from '@/lib/storage-paths';

export { isTenantPath };

/**
 * File storage behind one interface, on the provider STORAGE_PROVIDER selects:
 *
 *   r2        Cloudflare R2 (10 GB free each month, no egress charges).
 *   supabase  Supabase Storage. The default, and the fallback when R2 is
 *             selected but not configured (check-env.mjs refuses that in
 *             production).
 *
 * Switching provider does not copy existing objects: move them first, keeping
 * the same <bucket>/<path> layout.
 *
 * Two kinds of function:
 *   - signedUrls, signedUrl and downloadFile take the caller's client and honour
 *     what that caller may see, on either provider.
 *   - uploadFile, getPresignedUrl and deleteFile are privileged. The caller must
 *     already have authorised the path, normally by reading it from a row
 *     through RLS.
 */

export type PrivateBucket = UploadBucket;
export type StorageProvider = 'r2' | 'supabase';

const DEFAULT_TTL_SECONDS = 60 * 60;

let warnedUnconfigured = false;

function activeR2Config(): R2Config | null {
  if ((process.env.STORAGE_PROVIDER ?? '').trim().toLowerCase() !== 'r2') return null;
  const config = r2ConfigFromEnv();
  if (!config && !warnedUnconfigured) {
    warnedUnconfigured = true;
    console.error('[storage] STORAGE_PROVIDER=r2 but R2_* is incomplete; using Supabase Storage');
  }
  return config;
}

export function storageProvider(): StorageProvider {
  return activeR2Config() ? 'r2' : 'supabase';
}

/**
 * The paths this caller may read on R2, which has no RLS. It applies the same
 * rule as the tenant_docs_read storage policy: a member of the school named by
 * the first folder.
 */
async function readablePaths(supabase: SupabaseClient<Database>, paths: string[]): Promise<string[]> {
  const schools = [...new Set(paths.map((path) => path.split('/')[0]))];
  const allowed = new Set<string>();
  await Promise.all(
    schools.map(async (school) => {
      // A first folder that is not a uuid makes the call fail, which refuses it.
      const { data } = await supabase.rpc('is_member_of', { target_school: school });
      if (data === true) allowed.add(school);
    }),
  );
  return paths.filter((path) => allowed.has(path.split('/')[0]) && !path.includes('..'));
}

/**
 * Signed URLs for objects in a private bucket, for what the caller's own client
 * may see. Missing or forbidden paths are simply absent from the map.
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

  const r2 = activeR2Config();
  if (r2) {
    const readable = await readablePaths(supabase, unique);
    await Promise.all(
      readable.map(async (path) => {
        urls.set(path, await presignGet(r2, r2Key(bucket, path), ttlSeconds));
      }),
    );
    return urls;
  }

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

export async function signedUrl(
  supabase: SupabaseClient<Database>,
  bucket: PrivateBucket,
  path: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<string | null> {
  return (await signedUrls(supabase, bucket, [path], ttlSeconds)).get(path) ?? null;
}

/** An object's bytes, for what the caller may see; null when missing or forbidden. */
export async function downloadFile(
  supabase: SupabaseClient<Database>,
  bucket: PrivateBucket,
  path: string,
): Promise<Buffer | null> {
  const r2 = activeR2Config();
  if (r2) {
    const [readable] = await readablePaths(supabase, [path]);
    if (!readable) return null;
    try {
      return await getObject(r2, r2Key(bucket, path));
    } catch (error) {
      console.error('[storage] download failed', { bucket, reason: error instanceof Error ? error.message : 'unknown' });
      return null;
    }
  }

  const { data } = await supabase.storage.from(bucket).download(path);
  return data ? Buffer.from(await data.arrayBuffer()) : null;
}

/** Privileged: stores bytes server-side, replacing any object at that path. */
export async function uploadFile(
  bucket: string,
  path: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  const r2 = activeR2Config();
  if (r2) {
    await putObject(r2, r2Key(bucket, path), body, contentType);
    return;
  }
  const { error } = await createAdminClient()
    .storage.from(bucket)
    .upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(error.message);
}

/** Privileged: a time-limited URL for one object. */
export async function getPresignedUrl(
  bucket: string,
  path: string,
  options: { ttlSeconds?: number; downloadName?: string; inline?: boolean } = {},
): Promise<string> {
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const r2 = activeR2Config();
  if (r2) return presignGet(r2, r2Key(bucket, path), ttlSeconds, options);

  const { data, error } = await createAdminClient()
    .storage.from(bucket)
    .createSignedUrl(path, ttlSeconds, options.downloadName && !options.inline ? { download: options.downloadName } : undefined);
  if (error || !data) throw new Error(error?.message ?? 'could not sign the URL');
  return data.signedUrl;
}

/** Privileged: removes objects. A failure is logged, since it only leaves an orphan behind. */
export async function deleteFile(bucket: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    const r2 = activeR2Config();
    if (r2) {
      await removeObjects(r2, paths.map((path) => r2Key(bucket, path)));
      return;
    }
    const { error } = await createAdminClient().storage.from(bucket).remove(paths);
    if (error) throw new Error(error.message);
  } catch (error) {
    console.error('[storage] delete failed', { bucket, reason: error instanceof Error ? error.message : 'unknown' });
  }
}

/** Privileged: an upload URL bound to one type and size. R2 only; Supabase uploads go straight through RLS. */
export async function createR2UploadUrl(
  bucket: PrivateBucket,
  path: string,
  contentType: string,
  size: number,
): Promise<string | null> {
  const r2 = activeR2Config();
  return r2 ? presignPut(r2, r2Key(bucket, path), contentType, size) : null;
}

/** Whether an archived object already exists on R2. */
export async function r2FileExists(bucket: string, path: string): Promise<boolean> {
  const r2 = activeR2Config();
  return r2 ? objectExists(r2, r2Key(bucket, path)) : false;
}
