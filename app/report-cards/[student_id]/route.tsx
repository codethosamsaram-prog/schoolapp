import { NextResponse, type NextRequest } from 'next/server';
import { renderToStream } from '@react-pdf/renderer';
import { createClient } from '@/lib/supabase/server';
import { gpa, gradeFor } from '@/lib/grading';
import { formatDate } from '@/lib/utils';
import { ReportCardPDF } from '@/components/pdf/ReportCardPDF';

/**
 * Streams a student's report card for one examination:
 * /report-cards/<student_id>?exam=<exam name>[&download=1]
 *
 * Every read runs on the caller's own session. exam_results_select lets staff
 * see any student in their school and a student or parent only their own, so
 * anyone else gets the same 404 as a report card that does not exist.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: { student_id: string };
}

function notFound() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const examName = request.nextUrl.searchParams.get('exam')?.trim();
  if (!UUID_PATTERN.test(params.student_id) || !examName || examName.length > 80) {
    return notFound();
  }

  const supabase = createClient();
  const { data: student } = await supabase
    .from('students')
    .select('id, school_id, full_name, usn, roll_number, admission_number, class_grade, section')
    .eq('id', params.student_id)
    .maybeSingle();
  if (!student) return notFound();

  const [{ data: results }, { data: school }] = await Promise.all([
    supabase
      .from('exam_results')
      .select('subject, marks_obtained, max_marks, grade, remarks')
      .eq('student_id', student.id)
      .eq('exam_name', examName)
      .order('subject'),
    supabase
      .from('schools')
      .select('name, address, city, state, pincode, board, primary_color')
      .eq('id', student.school_id)
      .maybeSingle(),
  ]);
  if (!school || !results || results.length === 0) return notFound();

  const rows = results.map((row) => {
    const marks = Number(row.marks_obtained);
    const max = Number(row.max_marks);
    const computed = gradeFor(marks, max);
    return {
      subject: row.subject,
      marks,
      max,
      percent: computed.percent,
      grade: row.grade ?? computed.grade,
      passed: computed.passed,
      remarks: row.remarks,
    };
  });
  const totalMarks = rows.reduce((sum, row) => sum + row.marks, 0);
  const totalMax = rows.reduce((sum, row) => sum + row.max, 0);

  const stream = await renderToStream(
    <ReportCardPDF
      school={{
        name: school.name,
        addressLine:
          [school.address, school.city, school.state, school.pincode].filter(Boolean).join(', ') || null,
        board: school.board,
      }}
      student={{
        fullName: student.full_name,
        usn: student.usn,
        rollNumber: student.roll_number,
        admissionNumber: student.admission_number,
        classGrade: student.class_grade,
        section: student.section,
      }}
      examName={examName}
      rows={rows}
      totals={{
        marks: totalMarks,
        max: totalMax,
        percent: totalMax ? Math.round((totalMarks / totalMax) * 1000) / 10 : 0,
        gpa: gpa(rows.map((row) => ({ marks: row.marks, maxMarks: row.max }))),
        failed: rows.filter((row) => !row.passed).length,
      }}
      issuedOn={formatDate(new Date().toISOString())}
      accentColor={school.primary_color ?? '#1d4ed8'}
    />,
  );

  const download = request.nextUrl.searchParams.get('download') === '1';
  const slug = (value: string) => value.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-|-$/g, '');
  const filename = `report-card-${slug(student.usn ?? student.roll_number)}-${slug(examName)}.pdf`;

  return new NextResponse(stream as unknown as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
