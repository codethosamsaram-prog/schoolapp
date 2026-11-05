'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult } from '@/types/database';
import { createClient } from '@/lib/supabase/server';
import { requireTenantSession } from '@/lib/auth';
import { appUrl } from '@/lib/env';
import { receiptPathSuffix } from '@/lib/tokens';
import { notifyFamily } from '@/lib/notifications';
import { sendPaymentConfirmation } from '@/lib/whatsapp';
import { VPA_PATTERN, parseBankStatement, statementShowsAmount } from '@/lib/upi';
import { formatINR } from '@/lib/utils';

type SessionClient = ReturnType<typeof createClient>;

const ADMIN_ROLES = ['SUPER_ADMIN', 'SCHOOL_ADMIN'] as const;

function revalidateUpiViews(schoolSlug: string) {
  revalidatePath(`/${schoolSlug}/admin/finance/utr-verification`);
  revalidatePath(`/${schoolSlug}/admin/fees`);
  revalidatePath(`/${schoolSlug}/admin/dashboard`);
  revalidatePath(`/${schoolSlug}/portal`, 'layout');
}

const vpaSchema = z.object({
  vpa: z
    .string()
    .trim()
    .transform((value) => value || null)
    .refine((value) => value === null || VPA_PATTERN.test(value), 'Enter a UPI ID like school@okaxis'),
});

/** Sets (or clears) the UPI ID families pay to. */
export async function setSchoolUpiVpa(
  schoolSlug: string,
  formData: FormData,
): Promise<ActionResult<{ vpa: string | null }>> {
  const parsed = vpaSchema.safeParse({ vpa: formData.get('vpa') ?? '' });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Enter a valid UPI ID.',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { school } = await requireTenantSession(schoolSlug, [...ADMIN_ROLES]);
  const { error } = await createClient().from('schools').update({ upi_vpa: parsed.data.vpa }).eq('id', school.id);
  if (error) {
    console.error('[upi] vpa update failed', { error: error.message });
    return { ok: false, error: 'Could not save the UPI ID. Please try again.' };
  }

  revalidateUpiViews(schoolSlug);
  return { ok: true, data: { vpa: parsed.data.vpa } };
}

interface Decided {
  paymentId: string | null;
}

/**
 * One decision through review_upi_claim(), which locks the claim, re-checks
 * the balance, and on approval records the payment with the next receipt
 * number in the same transaction. The family hears about it either way.
 */
async function decide(
  supabase: SessionClient,
  school: { id: string; name: string; slug: string },
  claimId: string,
  approve: boolean,
  note: string | null,
): Promise<ActionResult<Decided>> {
  const { data: claim } = await supabase
    .from('upi_payment_claims')
    .select('id, student_id, amount, utr')
    .eq('id', claimId)
    .eq('school_id', school.id)
    .maybeSingle();
  if (!claim) return { ok: false, error: 'That claim is not in your queue.' };

  const { data: paymentId, error } = await supabase.rpc('review_upi_claim', {
    target_claim: claim.id,
    approve,
    note,
  });
  if (error) {
    // 22023: already decided, or more than the balance. Safe to show.
    const message = error.code === '22023' ? error.message : 'Could not update this claim. Please try again.';
    if (error.code !== '22023') console.error('[upi] review failed', { error: error.message });
    return { ok: false, error: message.charAt(0).toUpperCase() + message.slice(1) + '.' };
  }

  // The decision is recorded from here on; what follows is best effort.
  try {
    const { data: student } = await supabase
      .from('students')
      .select('id, full_name, parent_name, parent_phone, current_balance')
      .eq('id', claim.student_id)
      .single();
    if (!student) return { ok: true, data: { paymentId } };

    if (approve && paymentId) {
      const suffix = receiptPathSuffix(paymentId);
      const { data: payment } = await supabase
        .from('fee_payments')
        .update({ receipt_url: appUrl(`/${suffix}`) })
        .eq('id', paymentId)
        .eq('school_id', school.id)
        .select('receipt_number')
        .single();
      const receiptNumber = payment?.receipt_number ?? '';
      const outstanding = formatINR(Math.max(Number(student.current_balance), 0), true);

      await notifyFamily({
        schoolId: school.id,
        studentId: student.id,
        type: 'FEE',
        title: 'UPI payment verified',
        body: `${formatINR(claim.amount, true)} (UTR ${claim.utr}) received for ${student.full_name}. Receipt ${receiptNumber}. Outstanding: ${outstanding}.`,
        link: `/${school.slug}/portal/fees`,
        whatsapp: () =>
          sendPaymentConfirmation({
            parentPhone: student.parent_phone,
            parentName: student.parent_name ?? 'Parent',
            studentName: student.full_name,
            schoolName: school.name,
            amountPaid: formatINR(claim.amount, true),
            receiptNumber,
            outstandingBalance: outstanding,
            receiptPathSuffix: suffix,
          }),
      });
    } else {
      // No WhatsApp template exists for this; families without a login hear from the office.
      await notifyFamily({
        schoolId: school.id,
        studentId: student.id,
        type: 'FEE',
        title: 'UPI payment not verified',
        body: `We could not match ${formatINR(claim.amount, true)} (UTR ${claim.utr}) for ${student.full_name} with our bank statement${
          note ? `: ${note}` : ''
        }. Please check the UTR and report it again, or contact the school office.`,
        link: `/${school.slug}/portal/pay-upi`,
      });
    }
  } catch (error) {
    console.error('[upi] decided, notification skipped', {
      claimId,
      reason: error instanceof Error ? error.message : 'unknown',
    });
  }

  return { ok: true, data: { paymentId } };
}

const reviewSchema = z.object({
  claimId: z.string().uuid('Unknown claim'),
  approve: z.boolean(),
  note: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((value) => value || null),
});

export async function reviewUpiClaim(
  schoolSlug: string,
  input: { claimId: string; approve: boolean; note?: string },
): Promise<ActionResult<Decided>> {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request.' };

  const { school } = await requireTenantSession(schoolSlug, [...ADMIN_ROLES]);
  const result = await decide(createClient(), school, parsed.data.claimId, parsed.data.approve, parsed.data.note);
  revalidateUpiViews(schoolSlug);
  return result;
}

const statementSchema = z.object({
  statement: z.string().min(12, 'Paste or upload the bank statement').max(1_500_000, 'That statement is too large'),
});

export interface ReconcileSummary {
  /** UTRs approved because the statement shows them with the claimed amount. */
  approved: string[];
  /** On the statement, but with a different amount: left for a person to check. */
  amountMismatch: string[];
  /** Approval was refused, e.g. the claim is now more than the balance. */
  failed: { utr: string; error: string }[];
  /** Pending claims whose UTR is not on this statement. */
  notOnStatement: number;
}

/**
 * Semi-automatic reconciliation: every pending claim whose UTR appears on the
 * statement with exactly the claimed amount is approved (receipt issued);
 * everything else stays pending for a person to look at.
 */
export async function reconcileBankStatement(
  schoolSlug: string,
  formData: FormData,
): Promise<ActionResult<ReconcileSummary>> {
  const parsed = statementSchema.safeParse({ statement: formData.get('statement') ?? '' });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid statement.' };

  const { school } = await requireTenantSession(schoolSlug, [...ADMIN_ROLES]);
  const supabase = createClient();

  const { data: pending, error } = await supabase
    .from('upi_payment_claims')
    .select('id, utr, amount')
    .eq('school_id', school.id)
    .eq('status', 'PENDING')
    .order('created_at')
    .limit(1000);
  if (error) {
    console.error('[upi] queue query failed', { error: error.message });
    return { ok: false, error: 'Could not load the queue. Please try again.' };
  }

  const statement = parseBankStatement(parsed.data.statement);
  const summary: ReconcileSummary = { approved: [], amountMismatch: [], failed: [], notOnStatement: 0 };

  // Sequential: each approval moves the student's balance the next may depend on.
  for (const claim of pending ?? []) {
    const match = statement.get(claim.utr);
    if (!match) {
      summary.notOnStatement += 1;
      continue;
    }
    if (!statementShowsAmount(match, Number(claim.amount))) {
      summary.amountMismatch.push(claim.utr);
      continue;
    }
    const result = await decide(supabase, school, claim.id, true, 'Matched on bank statement');
    if (result.ok) summary.approved.push(claim.utr);
    else summary.failed.push({ utr: claim.utr, error: result.error });
  }

  revalidateUpiViews(schoolSlug);
  return { ok: true, data: summary };
}
