import { NextResponse, type NextRequest } from 'next/server';
import { renderToStream } from '@react-pdf/renderer';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { verifyReceiptToken } from '@/lib/tokens';
import { FeeReceiptPDF, type FeeReceiptLineItem } from '@/components/pdf/FeeReceiptPDF';

/**
 * Streams the official PDF receipt for one payment.
 *
 * Two ways in:
 *   1. A signed link (?t=...) delivered to the parent over WhatsApp. The token
 *      is an HMAC over this payment id, so it grants access to this receipt
 *      and nothing else.
 *   2. A signed-in user whose RLS view already includes the payment: school
 *      staff, or the student's own parent account.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: { payment_id: string };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: RouteParams) {
  const paymentId = params.payment_id;

  if (!UUID_PATTERN.test(paymentId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const token = request.nextUrl.searchParams.get('t');
  const tokenValid = token ? verifyReceiptToken(paymentId, token) : false;

  // Without a valid token, fall back to the caller's own RLS-scoped view.
  if (!tokenValid) {
    const userClient = createClient();
    const { data: visible, error } = await userClient
      .from('fee_payments')
      .select('id')
      .eq('id', paymentId)
      .maybeSingle();

    if (error || !visible) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
  }

  // The token proves authorisation for this one row, so the privileged read
  // that follows is scoped to exactly that id.
  const admin = createAdminClient();

  const { data: payment, error: paymentError } = await admin
    .from('fee_payments')
    .select(
      'id, school_id, student_id, fee_structure_id, amount_paid, payment_method, razorpay_order_id, razorpay_payment_id, status, amount_refunded, receipt_number, paid_at, created_at, notes',
    )
    .eq('id', paymentId)
    .maybeSingle();

  if (paymentError || !payment) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const [{ data: school }, { data: student }, { data: feeHead }] = await Promise.all([
    admin
      .from('schools')
      .select('name, logo_url, address, city, state, pincode, contact_phone, contact_email, board, primary_color')
      .eq('id', payment.school_id)
      .maybeSingle(),
    admin
      .from('students')
      .select('full_name, roll_number, admission_number, class_grade, section, parent_name, total_fee_due, current_balance')
      .eq('id', payment.student_id)
      .eq('school_id', payment.school_id)
      .maybeSingle(),
    payment.fee_structure_id
      ? admin
          .from('fee_structures')
          .select('title, amount')
          .eq('id', payment.fee_structure_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (!school || !student) {
    return NextResponse.json({ error: 'Receipt is incomplete' }, { status: 404 });
  }

  const lineItems: FeeReceiptLineItem[] = feeHead
    ? [{ particulars: feeHead.title, amount: Number(payment.amount_paid) }]
    : [{ particulars: payment.notes ?? 'Fee payment', amount: Number(payment.amount_paid) }];

  const addressLine = [school.address, school.city, school.state, school.pincode]
    .filter(Boolean)
    .join(', ');

  const stream = await renderToStream(
    <FeeReceiptPDF
      school={{
        name: school.name,
        logoUrl: school.logo_url,
        addressLine: addressLine || null,
        phone: school.contact_phone,
        email: school.contact_email,
        board: school.board,
      }}
      student={{
        fullName: student.full_name,
        rollNumber: student.roll_number,
        admissionNumber: student.admission_number,
        classGrade: student.class_grade,
        section: student.section,
        parentName: student.parent_name,
      }}
      payment={{
        receiptNumber: payment.receipt_number ?? `PROVISIONAL-${payment.id.slice(0, 8)}`,
        paidAt: payment.paid_at ?? payment.created_at,
        amountPaid: Number(payment.amount_paid),
        paymentMethod: payment.payment_method,
        razorpayPaymentId: payment.razorpay_payment_id,
        razorpayOrderId: payment.razorpay_order_id,
        status: payment.status,
        amountRefunded: Number(payment.amount_refunded),
      }}
      lineItems={lineItems}
      totalFeeDue={Number(student.total_fee_due)}
      balanceAfterPayment={Number(student.current_balance)}
      accentColor={school.primary_color ?? '#1d4ed8'}
    />,
  );

  const filename = `receipt-${(payment.receipt_number ?? payment.id).replace(/[^a-zA-Z0-9-]/g, '-')}.pdf`;

  // renderToStream yields a Node stream; NextResponse accepts it as the body.
  return new NextResponse(stream as unknown as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
