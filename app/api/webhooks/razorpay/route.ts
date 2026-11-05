import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, FeePayment } from '@/types/database';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  describeMethod,
  isPaymentEvent,
  normaliseRefundStatus,
  paiseToRupees,
  verifyWebhookSignature,
  type RazorpayPaymentEntity,
  type RazorpayRefundEntity,
} from '@/lib/razorpay';
import { isSettledPayment } from '@/lib/constants';
import { sendPaymentConfirmation } from '@/lib/whatsapp';
import { notifyFamily, wasDelivered } from '@/lib/notifications';
import { receiptPathSuffix } from '@/lib/tokens';
import { formatINR } from '@/lib/utils';

/**
 * Razorpay webhook receiver.
 *
 * Contract with the gateway:
 *   - Verify the HMAC over the RAW body before touching the payload.
 *   - Be idempotent: Razorpay retries until it sees a 2xx, and the same
 *     payment.captured event will arrive more than once.
 *   - Return 2xx for anything we have deliberately ignored, and 4xx/5xx only
 *     when a retry could actually help.
 *
 * Authentication is by signature, not by session, so this route is excluded
 * from the auth middleware and runs on the service-role client.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface StudentContext {
  id: string;
  full_name: string;
  parent_name: string | null;
  parent_phone: string;
  current_balance: number;
}

interface SchoolContext {
  id: string;
  name: string;
  slug: string;
}

function ok(message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ received: true, message, ...extra }, { status: 200 });
}

export async function POST(request: NextRequest) {
  // 1. Raw body first: re-serialising parsed JSON would break the HMAC.
  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature');

  let signatureValid: boolean;
  try {
    signatureValid = verifyWebhookSignature(rawBody, signature);
  } catch (error) {
    console.error('[razorpay] webhook secret misconfigured', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  if (!signatureValid) {
    console.warn('[razorpay] rejected webhook with invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // 2. Parse only after the signature has been accepted.
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Malformed JSON body' }, { status: 400 });
  }

  if (!isPaymentEvent(payload)) {
    return ok('Unrecognised payload shape, ignored');
  }

  const event = payload.event;
  const supabase = createAdminClient();

  const refund = payload.payload.refund?.entity;
  if (event.startsWith('refund.') && refund) {
    return handleRefundEvent(supabase, event, refund);
  }

  const payment = payload.payload.payment?.entity;

  if (!payment) {
    return ok(`Event ${event} carries no payment entity, ignored`);
  }

  switch (event) {
    case 'payment.captured':
      return handlePaymentCaptured(supabase, payment);
    case 'payment.failed':
      return handlePaymentFailed(supabase, payment);
    default:
      return ok(`Event ${event} is not handled by ClassroomOS`);
  }
}

/** Razorpay also probes the endpoint with a GET when the URL is saved. */
export async function GET() {
  return NextResponse.json({ status: 'ready', endpoint: 'razorpay-webhook' }, { status: 200 });
}

/* ---------------------------------------------------------------------------
 * payment.captured
 * ------------------------------------------------------------------------- */

async function handlePaymentCaptured(
  supabase: SupabaseClient<Database>,
  payment: RazorpayPaymentEntity,
) {
  const amountInRupees = paiseToRupees(payment.amount);

  // 3. Locate our record. The order id is written when checkout is opened;
  //    the payment id is written the first time this event is processed, and
  //    both carry unique constraints, which is what makes retries safe.
  const { data: existing, error: lookupError } = await supabase
    .from('fee_payments')
    .select('*')
    .or(
      [
        payment.order_id ? `razorpay_order_id.eq.${payment.order_id}` : null,
        `razorpay_payment_id.eq.${payment.id}`,
      ]
        .filter(Boolean)
        .join(','),
    )
    .maybeSingle();

  if (lookupError) {
    console.error('[razorpay] payment lookup failed', { paymentId: payment.id, error: lookupError.message });
    // A retry may succeed once the database is reachable again.
    return NextResponse.json({ error: 'Lookup failed' }, { status: 503 });
  }

  let record: FeePayment | null = existing;

  // 4. No local row: the payment was raised outside the app (a payment link or
  //    a manual order). Reconstruct it from the notes Razorpay echoes back.
  if (!record) {
    const schoolId = payment.notes?.school_id;
    const studentId = payment.notes?.student_id;

    if (!schoolId || !studentId) {
      console.warn('[razorpay] captured payment has no matching record and no notes', {
        paymentId: payment.id,
        orderId: payment.order_id,
      });
      // Nothing a retry can fix; acknowledge so Razorpay stops resending.
      return ok('No matching fee record and insufficient notes to create one');
    }

    const { data: created, error: createError } = await supabase
      .from('fee_payments')
      .insert({
        school_id: schoolId,
        student_id: studentId,
        fee_structure_id: payment.notes?.fee_structure_id ?? null,
        amount_paid: amountInRupees,
        payment_method: describeMethod(payment),
        razorpay_order_id: payment.order_id,
        razorpay_payment_id: payment.id,
        status: 'PENDING',
        notes: payment.description ?? null,
      })
      .select('*')
      .single();

    if (createError || !created) {
      console.error('[razorpay] failed to create reconciliation record', {
        paymentId: payment.id,
        error: createError?.message,
      });
      return NextResponse.json({ error: 'Could not record payment' }, { status: 503 });
    }

    record = created;
  }

  // 5. Idempotency: a second delivery of an already settled payment is a no-op,
  //    including one that has since been refunded.
  if (isSettledPayment(record.status) && record.razorpay_payment_id === payment.id) {
    return ok('Payment already reconciled', { paymentId: record.id });
  }

  // 6. Receipt number is allocated once, and only on first settlement.
  let receiptNumber = record.receipt_number;
  if (!receiptNumber) {
    const { data: generated, error: receiptError } = await supabase.rpc('next_receipt_number', {
      target_school: record.school_id,
    });

    if (receiptError || !generated) {
      console.error('[razorpay] receipt number generation failed', {
        paymentId: record.id,
        error: receiptError?.message,
      });
      return NextResponse.json({ error: 'Receipt generation failed' }, { status: 503 });
    }
    receiptNumber = generated;
  }

  const receiptUrl = new URL(
    `/${receiptPathSuffix(record.id)}`,
    process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  ).toString();

  // 7. Settle. The school_id filter is belt-and-braces on a service-role write.
  const { data: settled, error: updateError } = await supabase
    .from('fee_payments')
    .update({
      status: 'SUCCESS',
      amount_paid: amountInRupees,
      payment_method: describeMethod(payment),
      razorpay_payment_id: payment.id,
      razorpay_order_id: payment.order_id ?? record.razorpay_order_id,
      receipt_number: receiptNumber,
      receipt_url: receiptUrl,
      paid_at: new Date(payment.created_at * 1000).toISOString(),
    })
    .eq('id', record.id)
    .eq('school_id', record.school_id)
    .select('*')
    .single();

  if (updateError || !settled) {
    console.error('[razorpay] failed to settle payment', {
      paymentId: record.id,
      error: updateError?.message,
    });
    return NextResponse.json({ error: 'Could not settle payment' }, { status: 503 });
  }

  // 8. students.current_balance is recalculated by the trg_fee_payments_balance
  //    trigger, so read it back rather than computing a second opinion here.
  const [{ data: student, error: studentError }, { data: school, error: schoolError }] =
    await Promise.all([
      supabase
        .from('students')
        .select('id, full_name, parent_name, parent_phone, current_balance')
        .eq('id', settled.student_id)
        .eq('school_id', settled.school_id)
        .single<StudentContext>(),
      supabase
        .from('schools')
        .select('id, name, slug')
        .eq('id', settled.school_id)
        .single<SchoolContext>(),
    ]);

  if (studentError || schoolError || !student || !school) {
    console.error('[razorpay] settled but context lookup failed', {
      paymentId: settled.id,
      studentError: studentError?.message,
      schoolError: schoolError?.message,
    });
    // The money is reconciled; the notification is best effort.
    return ok('Payment settled, notification skipped', { paymentId: settled.id });
  }

  // 9. Confirmation to the family: in the portal, or by WhatsApp with a
  //    signed link to the receipt PDF when they have no portal login.
  const outstanding = formatINR(Math.max(Number(student.current_balance), 0), true);
  const outcome = await notifyFamily({
    schoolId: school.id,
    studentId: student.id,
    type: 'FEE',
    title: 'Payment received',
    body: `${formatINR(amountInRupees, true)} received for ${student.full_name}. Receipt ${receiptNumber}. Outstanding: ${outstanding}.`,
    link: `/${school.slug}/portal/fees`,
    whatsapp: () =>
      sendPaymentConfirmation({
        parentPhone: student.parent_phone,
        parentName: student.parent_name ?? 'Parent',
        studentName: student.full_name,
        schoolName: school.name,
        amountPaid: formatINR(amountInRupees, true),
        receiptNumber: receiptNumber,
        outstandingBalance: outstanding,
        receiptPathSuffix: receiptPathSuffix(settled.id),
      }),
  });

  console.info('[razorpay] payment settled', {
    paymentId: settled.id,
    razorpayPaymentId: payment.id,
    school: school.slug,
    amount: amountInRupees,
    receiptNumber,
    inApp: outcome.inApp,
    whatsapp: outcome.whatsapp ? (outcome.whatsapp.ok ? 'sent' : outcome.whatsapp.error) : 'not needed',
  });

  return ok('Payment settled', {
    paymentId: settled.id,
    receiptNumber,
    balance: student.current_balance,
    notified: wasDelivered(outcome),
  });
}

/* ---------------------------------------------------------------------------
 * payment.failed
 * ------------------------------------------------------------------------- */

async function handlePaymentFailed(
  supabase: SupabaseClient<Database>,
  payment: RazorpayPaymentEntity,
) {
  if (!payment.order_id) {
    return ok('Failed payment without an order id, ignored');
  }

  const { data, error } = await supabase
    .from('fee_payments')
    .update({
      status: 'FAILED',
      razorpay_payment_id: payment.id,
      payment_method: describeMethod(payment),
      notes: payment.error_description ?? payment.error_code ?? 'Payment failed at gateway',
    })
    .eq('razorpay_order_id', payment.order_id)
    .in('status', ['PENDING', 'FAILED'])
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[razorpay] failed to mark payment failed', {
      orderId: payment.order_id,
      error: error.message,
    });
    return NextResponse.json({ error: 'Could not record failure' }, { status: 503 });
  }

  return ok(data ? 'Payment marked failed' : 'No pending payment matched, ignored');
}

/* ---------------------------------------------------------------------------
 * refund.created / refund.processed / refund.failed
 *
 * Refunds issued from ClassroomOS are normally recorded by the refund route
 * already; these events move them to processed or failed. A refund with no
 * local row (issued from the Razorpay dashboard, or whose ledger write failed)
 * is recorded here against the payment it belongs to.
 * ------------------------------------------------------------------------- */

async function handleRefundEvent(
  supabase: SupabaseClient<Database>,
  event: string,
  refund: RazorpayRefundEntity,
) {
  const status =
    event === 'refund.failed'
      ? 'failed'
      : event === 'refund.processed'
        ? 'processed'
        : normaliseRefundStatus(refund.status);

  const { data: existing, error: lookupError } = await supabase
    .from('fee_refunds')
    .select('id, status')
    .eq('razorpay_refund_id', refund.id)
    .maybeSingle();

  if (lookupError) {
    console.error('[razorpay] refund lookup failed', { refundId: refund.id, error: lookupError.message });
    return NextResponse.json({ error: 'Lookup failed' }, { status: 503 });
  }

  if (existing) {
    // Events can arrive out of order; a settled refund never goes back to pending.
    if (existing.status === status || status === 'pending') {
      return ok('Refund already up to date', { refundId: refund.id });
    }
    const { error } = await supabase.from('fee_refunds').update({ status }).eq('id', existing.id);
    if (error) {
      console.error('[razorpay] refund status update failed', { refundId: refund.id, error: error.message });
      return NextResponse.json({ error: 'Could not update refund' }, { status: 503 });
    }
    return ok(`Refund marked ${status}`, { refundId: refund.id });
  }

  const { data: payment } = await supabase
    .from('fee_payments')
    .select('id, school_id')
    .eq('razorpay_payment_id', refund.payment_id)
    .maybeSingle();

  if (!payment) {
    return ok('Refund for a payment ClassroomOS does not know, ignored');
  }

  const notes = Array.isArray(refund.notes) ? {} : refund.notes;
  const reason = notes.reason?.trim();

  const { error } = await supabase.from('fee_refunds').insert({
    school_id: payment.school_id,
    payment_id: payment.id,
    razorpay_refund_id: refund.id,
    amount: paiseToRupees(refund.amount),
    reason: reason && reason.length >= 3 ? reason.slice(0, 200) : 'Refunded from the Razorpay dashboard',
    status,
    initiated_by: null,
  });

  if (error) {
    // A concurrent delivery or the refund route recorded it first.
    if (error.code === '23505') return ok('Refund already recorded', { refundId: refund.id });
    console.error('[razorpay] could not record refund', { refundId: refund.id, error: error.message });
    // A constraint violation will not fix itself on retry.
    return error.code?.startsWith('23')
      ? ok('Refund could not be recorded, ignored', { refundId: refund.id })
      : NextResponse.json({ error: 'Could not record refund' }, { status: 503 });
  }

  console.info('[razorpay] refund recorded from webhook', { refundId: refund.id, paymentId: payment.id });
  return ok('Refund recorded', { refundId: refund.id });
}
