import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth';
import { createOrder } from '@/lib/razorpay';
import { publicEnv } from '@/lib/env';

/**
 * Opens a Razorpay order for a fee payment and records the matching PENDING
 * row, which the webhook later settles by razorpay_order_id.
 *
 * Runs on the caller's session: `fee_payments_insert_admin` allows a school
 * admin, or the student's own parent creating a PENDING row. The amount is
 * taken from the fee structure in the database, never from the request body,
 * so the client cannot choose what it owes.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  studentId: z.string().uuid(),
  feeStructureId: z.string().uuid().optional(),
  amount: z.number().positive().max(10_00_000).optional(),
});

export async function POST(request: NextRequest) {
  const current = await getCurrentProfile();
  if (!current) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const supabase = createClient();

  // RLS decides visibility here: a parent sees only their own child.
  const { data: student, error: studentError } = await supabase
    .from('students')
    .select('id, school_id, full_name, roll_number, class_grade, current_balance')
    .eq('id', parsed.data.studentId)
    .maybeSingle();

  if (studentError || !student) {
    return NextResponse.json({ error: 'Student not found' }, { status: 404 });
  }

  let amount = parsed.data.amount ?? Number(student.current_balance);
  let feeStructureId: string | null = parsed.data.feeStructureId ?? null;

  if (feeStructureId) {
    const { data: feeHead, error: feeError } = await supabase
      .from('fee_structures')
      .select('id, amount')
      .eq('id', feeStructureId)
      .eq('school_id', student.school_id)
      .maybeSingle();

    if (feeError || !feeHead) {
      return NextResponse.json({ error: 'Fee head not found' }, { status: 404 });
    }
    amount = Number(feeHead.amount);
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Nothing is outstanding for this student' }, { status: 400 });
  }

  const { data: pending, error: insertError } = await supabase
    .from('fee_payments')
    .insert({
      school_id: student.school_id,
      student_id: student.id,
      fee_structure_id: feeStructureId,
      amount_paid: amount,
      payment_method: 'UPI',
      status: 'PENDING',
    })
    .select('id')
    .single();

  if (insertError || !pending) {
    console.error('[payments] could not open payment row', { error: insertError?.message });
    return NextResponse.json({ error: 'Could not start the payment' }, { status: 500 });
  }

  try {
    const order = await createOrder({
      amountInRupees: amount,
      receipt: pending.id,
      notes: {
        payment_id: pending.id,
        school_id: student.school_id,
        student_id: student.id,
        roll_number: student.roll_number,
        class_grade: student.class_grade,
        ...(feeStructureId ? { fee_structure_id: feeStructureId } : {}),
      },
    });

    const { error: linkError } = await supabase
      .from('fee_payments')
      .update({ razorpay_order_id: order.id })
      .eq('id', pending.id);

    if (linkError) {
      console.error('[payments] could not attach order id', {
        paymentId: pending.id,
        orderId: order.id,
        error: linkError.message,
      });
      return NextResponse.json({ error: 'Could not start the payment' }, { status: 500 });
    }

    return NextResponse.json({
      paymentId: pending.id,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: publicEnv.razorpayKeyId,
      studentName: student.full_name,
    });
  } catch (error) {
    // Leave a trace of the abandoned attempt rather than a silent orphan row.
    await supabase
      .from('fee_payments')
      .update({ status: 'FAILED', notes: 'Gateway order creation failed' })
      .eq('id', pending.id);

    console.error('[payments] razorpay order creation failed', {
      paymentId: pending.id,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return NextResponse.json({ error: 'Payment gateway unavailable' }, { status: 502 });
  }
}
