import { NextResponse, type NextRequest } from 'next/server';
import { renderToStream } from '@react-pdf/renderer';
import { createClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/utils';
import { HallTicketPDF } from '@/components/pdf/HallTicketPDF';

/**
 * Streams one hall ticket.
 *
 * Every read runs on the caller's own session: hall_tickets_select lets staff
 * see any ticket in their school, and a student or parent only their own once
 * it is published. A school-uploaded PDF is served through a short signed URL;
 * otherwise the ticket is rendered here.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: { ticket_id: string };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!UUID_PATTERN.test(params.ticket_id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const supabase = createClient();
  const { data: ticket } = await supabase
    .from('hall_tickets')
    .select('id, school_id, student_id, exam_name, term, ticket_pdf_url, created_at')
    .eq('id', params.ticket_id)
    .maybeSingle();

  if (!ticket) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (ticket.ticket_pdf_url) {
    const { data: signed } = await supabase.storage
      .from('academic-docs')
      .createSignedUrl(ticket.ticket_pdf_url, 300);
    if (!signed?.signedUrl) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.redirect(signed.signedUrl);
  }

  const [{ data: student }, { data: school }] = await Promise.all([
    supabase
      .from('students')
      .select('full_name, usn, roll_number, admission_number, class_grade, section, avatar_url')
      .eq('id', ticket.student_id)
      .eq('school_id', ticket.school_id)
      .maybeSingle(),
    supabase
      .from('schools')
      .select('name, address, city, state, pincode, board, primary_color')
      .eq('id', ticket.school_id)
      .maybeSingle(),
  ]);

  if (!student || !school) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Embed the photo as bytes so the PDF renderer never fetches a URL itself.
  let photo: Buffer | null = null;
  if (student.avatar_url) {
    const { data: blob } = await supabase.storage.from('avatars').download(student.avatar_url);
    if (blob) photo = Buffer.from(await blob.arrayBuffer());
  }

  const { data: holidays } = await supabase
    .from('holiday_calendar')
    .select('date, title')
    .eq('school_id', ticket.school_id)
    .eq('is_academic_holiday', true)
    .gte('date', new Date().toISOString().slice(0, 10))
    .order('date')
    .limit(5);

  const stream = await renderToStream(
    <HallTicketPDF
      school={{
        name: school.name,
        addressLine: [school.address, school.city, school.state, school.pincode].filter(Boolean).join(', ') || null,
        board: school.board,
      }}
      student={{
        fullName: student.full_name,
        usn: student.usn,
        rollNumber: student.roll_number,
        admissionNumber: student.admission_number,
        classGrade: student.class_grade,
        section: student.section,
        photo,
      }}
      ticket={{
        id: ticket.id,
        examName: ticket.exam_name,
        term: ticket.term,
        issuedOn: formatDate(ticket.created_at),
      }}
      holidays={(holidays ?? []).map((holiday) => ({ date: formatDate(holiday.date), title: holiday.title }))}
      accentColor={school.primary_color ?? '#1d4ed8'}
    />,
  );

  const download = request.nextUrl.searchParams.get('download') === '1';
  const filename = `hall-ticket-${(student.usn ?? student.roll_number).replace(/[^A-Za-z0-9-]/g, '-')}.pdf`;

  return new NextResponse(stream as unknown as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
