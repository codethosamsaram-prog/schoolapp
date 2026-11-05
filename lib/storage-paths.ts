/**
 * Object layout shared by the browser uploader, the server and both storage
 * providers. Every path starts with the school id, which is what Supabase
 * storage RLS checks and what lib/storage.ts checks before signing an R2 URL.
 */

export type UploadBucket = 'avatars' | 'academic-docs';

/** Size and type limits, the same as the Supabase bucket settings. */
export const BUCKET_RULES: Record<UploadBucket, { maxBytes: number; types: readonly string[] }> = {
  avatars: { maxBytes: 2 * 1024 * 1024, types: ['image/png', 'image/jpeg', 'image/webp'] },
  'academic-docs': {
    maxBytes: 10 * 1024 * 1024,
    types: [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/webp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
  },
};

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
 * <schoolId>/<prefix>-<stamp>.<ext> for avatars (the prefix is the student
 * id, which setStudentPhoto checks), <schoolId>/<prefix>/<stamp>-<name>
 * for documents.
 */
export function objectPath(
  bucket: UploadBucket,
  schoolId: string,
  prefix: string,
  file: { name: string; type: string },
  now = Date.now(),
): string {
  const extension = EXTENSIONS[file.type] ?? file.name.split('.').pop() ?? 'bin';
  const stamp = now.toString(36);
  return bucket === 'avatars'
    ? `${schoolId}/${prefix}-${stamp}.${extension}`
    : `${schoolId}/${prefix}/${stamp}-${safeName(file.name)}`;
}

/** A tenant-scoped path, so the first folder is always the school id RLS checks. */
export function isTenantPath(path: string, schoolId: string): boolean {
  return path.startsWith(`${schoolId}/`) && !path.includes('..');
}
