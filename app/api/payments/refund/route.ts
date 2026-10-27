import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentProfile } from '@/lib/auth';
import { canManageSchool } from '@/lib/auth-routes';
import { createClient } from '@/lib/supabase/server';
import { RazorpayApiError, refundPayment } from '@/lib/razorpay';
import { isSettledPayment } from '@/lib/constants';
import { formatINR } from '@/lib/utils';

/**
 * Refunds an online payment through Razorpay, in full or in part.
 *
 * Runs on the admin's own session, so fee_payments RLS scopes the lookup to
 * their tenant and fee_refunds_insert_admin authorises the ledger write. The
 * database then does the rest: trg_fee_refunds_sync moves amount_refunded,
 * derive_refund_status sets PARTIALLY_REFUNDED or REFUNDED, and the balance
 * trigger puts the refunded amount back on the student's balance.
 *
 * Order matters. The gateway is called first, because money that has not left
 * must never show as refunded. If the ledger write then fails, the refund
 * webhook finds the payment from the refund's notes and records it.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  payment_id: z.string().uuid(),
  reason: z.string().trim().min(3, 'Give a reason of at least 3 characters').max(200),
  amount: z.number().positive().max(10_00_000).optional(),
});

/** Razorpay refuses refunds below one rupee. */
const MINIMUM_REFUND = 1;

export async function POST(request: NextRequest) {
  const current = await getCurrentProfile();
  if (!current) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!canManageSchool(current.profile.role) || !current.profile.is_active) {
    return NextResponse.json({ error: 'Only a school admin can issue refunds' }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      { status: 400 },
    );
  }

  const supabase = createClient();

  const { data: payment } = await supabase
    .from('fee_payments')
    .select('id, school_id, student_id, status, amount_paid, amount_refunded, razorpay_payment_id, receipt_number')
    .eq('id', parsed.data.payment_id)
    .maybeSingle();

  // RLS already hides other tenants; the explicit check keeps a platform
  // operator's session from being the only thing standing between tenants.
  const inTenant =
    payment &&
    (current.profile.role === 'SUPER_ADMIN' || payment.school_id === current.profile.school_id);
  if (!payment || !inTenant) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }

  if (!payment.razorpay_payment_id) {
    return NextResponse.json(
      { error: 'This payment was taken at the office. Void the receipt instead.' },
      { status: 409 },
    );
  }
  if (!isSettledPayment(payment.status) || payment.status === 'REFUNDED') {
    return NextResponse.json(
      { error: `A ${payment.status.toLowerCase().replace(/_/g, ' ')} payment cannot be refunded` },
      { status: 409 },
    );
  }

  const refundable =
    Math.round((Number(payment.amount_paid) - Number(payment.amount_refunded)) * 100) / 100;
  const amount =
    parsed.data.amount === undefined ? refundable : Math.round(parsed.data.amount * 100) / 100;

  if (amount < MINIMUM_REFUND) {
    return NextResponse.json({ error: 'The smallest refund is ₹1' }, { status: 400 });
  }
  if (amount > refundable) {
    return NextResponse.json(
      { error: `At most ${formatINR(refundable, true)} can still be refunded` },
      { status: 400 },
    );
  }

  let refund;
  try {
    refund = await refundPayment({
      razorpayPaymentId: payment.razorpay_payment_id,
      amountInRupees: amount,
      notes: {
        reason: parsed.data.reason,
        fee_payment_id: payment.id,
        school_id: payment.school_id,
      },
    });
  } catch (error) {
    if (error instanceof RazorpayApiError) {
      console.warn('[refund] gateway rejected refund', {
        paymentId: payment.id,
        statusCode: error.statusCode,
        reason: error.message,
      });
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    console.error('[refund] gateway unavailable', {
      paymentId: payment.id,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return NextResponse.json({ error: 'Payment gateway unavailable' }, { status: 503 });
  }

  const { error: insertError } = await supabase.from('fee_refunds').insert({
    school_id: payment.school_id,
    payment_id: payment.id,
    razorpay_refund_id: refund.id,
    amount: refund.amount,
    reason: parsed.data.reason,
    status: refund.status,
  });

  // The money has moved either way. A duplicate means the webhook got there
  // first; anything else is left for the webhook to reconcile.
  const recorded = !insertError || insertError.code === '23505';
  if (!recorded) {
    console.error('[refund] refund issued but not recorded; awaiting webhook', {
      paymentId: payment.id,
      refundId: refund.id,
      error: insertError?.message,
    });
  }

  const { data: school } = await supabase
    .from('schools')
    .select('slug')
    .eq('id', payment.school_id)
    .maybeSingle();
  if (school) {
    for (const path of ['admin/fees', 'admin/students', 'admin/dashboard', 'portal']) {
      revalidatePath(`/${school.slug}/${path}`, path === 'portal' ? 'layout' : 'page');
    }
  }

  return NextResponse.json({
    refundId: refund.id,
    amount: refund.amount,
    status: refund.status,
    recorded,
  });
}
