import { NextResponse, type NextRequest } from 'next/server';
import { renderToStream } from '@react-pdf/renderer';
import { z } from 'zod';
import { getCurrentProfile } from '@/lib/auth';
import { canManageSchool } from '@/lib/auth-routes';
import { createClient } from '@/lib/supabase/server';
import { MAX_CARDS_PER_BATCH, loadIdCardData, qrPng } from '@/lib/id-cards';
import { IdCardsPDF } from '@/components/pdf/IdCardsPDF';

/**
 * Bulk student ID cards as one printable PDF:
 *   GET /api/id-cards?grade=IX&section=A[&student=<id>...][&download=1]
 *
 * Without `student`, every active student in the class section is included.
 * School admins only; reads run on their session, so ids from another school
 * simply match nothing.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  grade: z.string().trim().min(1).max(20),
  section: z.string().trim().min(1).max(5),
  student: z.array(z.string().uuid()).max(MAX_CARDS_PER_BATCH).optional(),
});

export async function GET(request: NextRequest) {
  const current = await getCurrentProfile();
  if (!current) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!canManageSchool(current.profile.role) || !current.profile.is_active || !current.profile.school_id) {
    return NextResponse.json({ error: 'Only a school admin can print ID cards' }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const students = params.getAll('student');
  const parsed = querySchema.safeParse({
    grade: params.get('grade'),
    section: params.get('section'),
    student: students.length ? students : undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Choose a class, a section and valid students' }, { status: 400 });
  }

  const supabase = createClient();
  const data = await loadIdCardData(supabase, current.profile.school_id, {
    grade: parsed.data.grade,
    section: parsed.data.section,
    studentIds: parsed.data.student,
  });
  if (!data || data.students.length === 0) {
    return NextResponse.json({ error: 'No matching students' }, { status: 404 });
  }

  // Photos and QR codes go in as bytes so the renderer never fetches a URL.
  const cards = await Promise.all(
    data.students.map(async (student) => {
      let photo: Buffer | null = null;
      if (student.avatarPath) {
        const { data: blob } = await supabase.storage.from('avatars').download(student.avatarPath);
        if (blob) photo = Buffer.from(await blob.arrayBuffer());
      }
      return { ...student, photo, qr: await qrPng(student.id) };
    }),
  );

  const stream = await renderToStream(<IdCardsPDF school={data.school} cards={cards} />);
  const safe = (value: string) => value.replace(/[^A-Za-z0-9-]+/g, '-');
  const filename = `id-cards-class-${safe(parsed.data.grade)}-${safe(parsed.data.section)}.pdf`;

  return new NextResponse(stream as unknown as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${params.get('download') === '1' ? 'attachment' : 'inline'}; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Card-Count': String(cards.length),
    },
  });
}
