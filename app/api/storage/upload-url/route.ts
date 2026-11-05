import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getCurrentProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createR2UploadUrl, storageProvider } from '@/lib/storage';
import { BUCKET_RULES, objectPath } from '@/lib/storage-paths';

/**
 * Prepares a browser upload. It applies the same rule as the tenant_docs_insert
 * storage policy (staff of the school named by the path), plus the bucket's
 * type and size limits, which R2 does not enforce itself. The signed PUT is
 * bound to the approved type and size.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  bucket: z.enum(['avatars', 'academic-docs']),
  schoolId: z.string().uuid(),
  prefix: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  name: z.string().min(1).max(255),
  type: z.string().min(1).max(120),
  size: z.number().int().positive(),
});

export async function POST(request: NextRequest) {
  const current = await getCurrentProfile();
  if (!current) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid upload request' }, { status: 400 });
  }
  const input = parsed.data;

  const { data: allowed } = await createClient().rpc('is_school_staff', { target_school: input.schoolId });
  if (allowed !== true) {
    return NextResponse.json({ error: 'You cannot upload files for this school' }, { status: 403 });
  }

  const rules = BUCKET_RULES[input.bucket];
  if (!rules.types.includes(input.type)) {
    return NextResponse.json({ error: 'That file type is not allowed here.' }, { status: 415 });
  }
  if (input.size > rules.maxBytes) {
    return NextResponse.json(
      { error: `That file is larger than the ${rules.maxBytes / (1024 * 1024)} MB limit.` },
      { status: 413 },
    );
  }

  const path = objectPath(input.bucket, input.schoolId, input.prefix, { name: input.name, type: input.type });
  if (storageProvider() === 'supabase') {
    return NextResponse.json({ provider: 'supabase', path });
  }

  const url = await createR2UploadUrl(input.bucket, path, input.type, input.size);
  return NextResponse.json({ provider: 'r2', path, url });
}
