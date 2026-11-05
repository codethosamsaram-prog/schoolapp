import { NextResponse, type NextRequest } from 'next/server';
import { renderToStream } from '@react-pdf/renderer';
import QRCode from 'qrcode';
import { createClient } from '@/lib/supabase/server';
import { netPaid } from '@/lib/constants';
import { buildUpiUri, invoiceRef } from '@/lib/upi';
import { formatDate, todayInIST } from '@/lib/utils';
import { FeeInvoicePDF } from '@/components/pdf/FeeInvoicePDF';

/**
 * Streams a student's fee invoice for the current academic year, with a UPI
 * QR for the balance when the school has a UPI ID. Reads run on the caller's
 * session, so only school staff and the student's own family get past RLS;
 * everyone else gets a 404.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: { student_id: string };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!UUID_PATTERN.test(params.student_id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const supabase = createClient();
  const { data: student } = await supabase
    .from('students')
    .select(
      'id, school_id, full_name, roll_number, admission_number, class_grade, section, parent_name, fee_concession, current_balance',
    )
    .eq('id', params.student_id)
    .maybeSingle();
  if (!student) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: academicYear } = await supabase.rpc('current_academic_year');
  const year = academicYear ?? '';

  const [{ data: school }, { data: heads }, { data: payments }] = await Promise.all([
    supabase
      .from('schools')
      .select('name, address, city, state, pincode, contact_phone, primary_color, upi_vpa')
      .eq('id', student.school_id)
      .maybeSingle(),
    supabase
      .from('fee_structures')
      .select('title, amount, due_date')
      .eq('school_id', student.school_id)
      .eq('class_grade', student.class_grade)
      .eq('academic_year', year)
      .or(`student_id.is.null,student_id.eq.${student.id}`)
      .order('due_date'),
    supabase.from('fee_payments').select('amount_paid, amount_refunded, status').eq('student_id', student.id),
  ]);
  if (!school) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const reference = invoiceRef(
    { admissionNumber: student.admission_number, rollNumber: student.roll_number },
    year,
  );
  const balance = Math.max(Number(student.current_balance), 0);
  const paid = (payments ?? []).reduce((sum, payment) => sum + netPaid(payment), 0);

  const upiQr =
    school.upi_vpa && balance > 0
      ? {
          vpa: school.upi_vpa,
          dataUrl: await QRCode.toDataURL(
            buildUpiUri({ vpa: school.upi_vpa, payeeName: school.name, amount: balance, note: reference }),
            { errorCorrectionLevel: 'M', margin: 1, width: 360 },
          ),
        }
      : null;

  const stream = await renderToStream(
    <FeeInvoicePDF
      school={{
        name: school.name,
        addressLine:
          [school.address, school.city, school.state, school.pincode].filter(Boolean).join(', ') || null,
        phone: school.contact_phone,
      }}
      student={{
        fullName: student.full_name,
        rollNumber: student.roll_number,
        admissionNumber: student.admission_number,
        classGrade: student.class_grade,
        section: student.section,
        parentName: student.parent_name,
      }}
      invoiceRef={reference}
      academicYear={year}
      issuedOn={formatDate(todayInIST())}
      lines={(heads ?? []).map((head) => ({
        particulars: head.title,
        dueDate: formatDate(head.due_date),
        amount: Number(head.amount),
      }))}
      concession={Number(student.fee_concession)}
      paid={paid}
      balance={balance}
      upiQr={upiQr}
      accentColor={school.primary_color ?? '#1d4ed8'}
    />,
  );

  const download = request.nextUrl.searchParams.get('download') === '1';
  return new NextResponse(stream as unknown as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${reference}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
