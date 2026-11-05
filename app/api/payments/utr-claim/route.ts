import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth';
import { UTR_PATTERN, normaliseUtr } from '@/lib/upi';
import { formatINR } from '@/lib/utils';

/**
 * A family reports a direct UPI payment by its 12-digit UTR, for the school
 * to verify against its bank statement (admin/finance/utr-verification).
 * Nothing is credited here: the claim is PENDING until an admin approves it,
 * which is when the receipt is issued and the balance moves.
 *
 * Runs on the caller's session. upi_payment_claims_insert admits only the
 * student or their linked parent, and the insert trigger pins the claim to
 * PENDING for a student of the same school. Rate limited with the other
 * /api/payments/ routes in middleware.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  studentId: z.string().uuid(),
  amount: z.number().positive().max(10_00_000).multipleOf(0.01),
  utr: z
    .string()
    .transform(normaliseUtr)
    .refine((value) => UTR_PATTERN.test(value), 'A UTR is 12 digits'),
  invoiceRef: z.string().trim().max(40).optional(),
});

export async function POST(request: NextRequest) {
  const current = await getCurrentProfile();
  if (!current) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (current.profile.role !== 'PARENT' && current.profile.role !== 'STUDENT') {
    return NextResponse.json({ error: 'Only families report UPI payments' }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      { status: 400 },
    );
  }
  const input = parsed.data;
  const supabase = createClient();

  // RLS: a family sees only its own children.
  const { data: student } = await supabase
    .from('students')
    .select('id, school_id, current_balance, is_active')
    .eq('id', input.studentId)
    .maybeSingle();
  if (!student || !student.is_active) {
    return NextResponse.json({ error: 'Student not found' }, { status: 404 });
  }

  // Claims awaiting review count against the balance too, so two reports
  // cannot together claim more than is owed.
  const { data: pending } = await supabase
    .from('upi_payment_claims')
    .select('amount')
    .eq('student_id', student.id)
    .eq('status', 'PENDING');
  const awaiting = (pending ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
  const claimable = Math.max(Number(student.current_balance) - awaiting, 0);
  if (input.amount > claimable + 0.005) {
    return NextResponse.json(
      {
        error:
          awaiting > 0
            ? `That is more than the ${formatINR(claimable, true)} outstanding after payments awaiting verification.`
            : `That is more than the ${formatINR(claimable, true)} outstanding.`,
      },
      { status: 422 },
    );
  }

  const { data: claim, error } = await supabase
    .from('upi_payment_claims')
    .insert({
      school_id: student.school_id,
      student_id: student.id,
      amount: input.amount,
      utr: input.utr,
      invoice_ref: input.invoiceRef ?? null,
      submitted_by: current.userId,
    })
    .select('id, amount, utr, status, created_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'This UTR has already been reported.' }, { status: 409 });
    }
    console.error('[upi] claim insert failed', { error: error.message, code: error.code });
    return NextResponse.json({ error: 'Could not record this payment. Please try again.' }, { status: 500 });
  }

  return NextResponse.json({ claim }, { status: 201 });
}
