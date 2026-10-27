'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult } from '@/types/database';
import { createClient } from '@/lib/supabase/server';
import { requireTenantSession } from '@/lib/auth';
import { MAX_BACKDATE_DAYS, MAX_LEAVE_DAYS, leaveDays } from '@/lib/leave';
import { todayInIST } from '@/lib/utils';

/**
 * Leave applications for students (applied by the student or a parent) and
 * staff (applied for themselves), and their review.
 *
 * Every write runs on the caller's session. RLS decides who may apply for
 * whom, and guard_leave_transition() decides who may approve, reject or
 * cancel. Approving student leave records EXCUSED_ABSENT attendance in the
 * database (apply_leave_to_attendance), not here.
 */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date');

function addDays(day: string, days: number): string {
  const value = new Date(`${day}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

const applySchema = z
  .object({
    studentId: z.string().uuid().optional(),
    leaveType: z.enum(['SICK', 'CASUAL', 'EMERGENCY'], { message: 'Choose the kind of leave' }),
    startDate: date,
    endDate: date,
    reason: z.string().trim().min(3, 'Give a short reason').max(500),
  })
  .refine((value) => value.endDate >= value.startDate, {
    path: ['endDate'],
    message: 'The last day cannot be before the first',
  })
  .refine((value) => leaveDays(value.startDate, value.endDate) <= MAX_LEAVE_DAYS, {
    path: ['endDate'],
    message: `One application can cover at most ${MAX_LEAVE_DAYS} days`,
  })
  .refine((value) => value.startDate >= addDays(todayInIST(), -MAX_BACKDATE_DAYS), {
    path: ['startDate'],
    message: `Leave can be applied for up to ${MAX_BACKDATE_DAYS} days after the fact`,
  });

function revalidateLeave(schoolSlug: string) {
  revalidatePath(`/${schoolSlug}/portal`, 'layout');
  revalidatePath(`/${schoolSlug}/teacher/leave`);
  revalidatePath(`/${schoolSlug}/teacher/attendance`);
  revalidatePath(`/${schoolSlug}/admin/leave`);
}

/** Students and parents apply for a student; staff apply for themselves. */
export async function applyForLeave(schoolSlug: string, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const parsed = applySchema.safeParse({
    studentId: formData.get('studentId') || undefined,
    leaveType: formData.get('leaveType'),
    startDate: formData.get('startDate'),
    endDate: formData.get('endDate'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { userId, profile, school } = await requireTenantSession(schoolSlug, [
    'SUPER_ADMIN',
    'SCHOOL_ADMIN',
    'TEACHER',
    'PARENT',
    'STUDENT',
  ]);
  const supabase = createClient();
  const input = parsed.data;
  const forStudent = profile.role === 'PARENT' || profile.role === 'STUDENT';

  if (forStudent) {
    // RLS returns the student only to themselves or their linked parent.
    const { data: student } = input.studentId
      ? await supabase.from('students').select('id').eq('id', input.studentId).eq('school_id', school.id).maybeSingle()
      : { data: null };
    if (!student) return { ok: false, error: 'Choose one of your children.' };
  }

  // One live application per person per day.
  let overlap = supabase
    .from('leave_requests')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', school.id)
    .in('status', ['PENDING', 'APPROVED'])
    .lte('start_date', input.endDate)
    .gte('end_date', input.startDate);
  overlap = forStudent ? overlap.eq('student_id', input.studentId!) : overlap.eq('staff_user_id', userId);
  const { count } = await overlap;
  if (count) {
    return {
      ok: false,
      error: 'There is already a pending or approved leave for some of these days.',
      fieldErrors: { startDate: ['Overlaps another application'] },
    };
  }

  const { data, error } = await supabase
    .from('leave_requests')
    .insert({
      school_id: school.id,
      applicant_kind: forStudent ? 'STUDENT' : 'STAFF',
      student_id: forStudent ? input.studentId! : null,
      staff_user_id: forStudent ? null : userId,
      requested_by: userId,
      leave_type: input.leaveType,
      start_date: input.startDate,
      end_date: input.endDate,
      reason: input.reason,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('[leave] application failed', { error: error?.message });
    return { ok: false, error: 'Could not submit the application. Please try again.' };
  }

  revalidateLeave(schoolSlug);
  return { ok: true, data: { id: data.id } };
}

const reviewSchema = z.object({
  leaveId: z.string().uuid(),
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().trim().max(300).optional(),
});

/** Teachers review student leave; admins review everyone's. Nobody reviews their own. */
export async function reviewLeave(
  schoolSlug: string,
  formData: FormData,
): Promise<ActionResult<{ status: 'APPROVED' | 'REJECTED'; excusedDays: number }>> {
  const parsed = reviewSchema.safeParse({
    leaveId: formData.get('leaveId'),
    decision: formData.get('decision'),
    note: formData.get('note') || undefined,
  });
  if (!parsed.success) return { ok: false, error: 'That review is not valid.' };

  const { school } = await requireTenantSession(schoolSlug, ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']);
  const supabase = createClient();

  const { data, error } = await supabase
    .from('leave_requests')
    .update({ status: parsed.data.decision, review_note: parsed.data.note ?? null })
    .eq('id', parsed.data.leaveId)
    .eq('school_id', school.id)
    .eq('status', 'PENDING')
    .select('status, applicant_kind, student_id, start_date, end_date')
    .maybeSingle();

  if (error) {
    // guard_leave_transition explains refusals in plain words.
    const refused = error.code === '42501' || error.code === '22023';
    if (!refused) console.error('[leave] review failed', { error: error.message });
    return {
      ok: false,
      error: refused
        ? error.message.charAt(0).toUpperCase() + error.message.slice(1) + '.'
        : 'Could not save the decision. Please try again.',
    };
  }
  if (!data) return { ok: false, error: 'This request has already been decided or withdrawn.' };

  let excusedDays = 0;
  if (data.status === 'APPROVED' && data.applicant_kind === 'STUDENT' && data.student_id) {
    const { count } = await supabase
      .from('attendance')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', data.student_id)
      .eq('status', 'EXCUSED_ABSENT')
      .gte('date', data.start_date)
      .lte('date', data.end_date);
    excusedDays = count ?? 0;
  }

  revalidateLeave(schoolSlug);
  return { ok: true, data: { status: parsed.data.decision, excusedDays } };
}

/** The applicant withdraws a request that has not been decided yet. */
export async function cancelLeave(schoolSlug: string, leaveId: string): Promise<ActionResult<{ id: string }>> {
  if (!z.string().uuid().safeParse(leaveId).success) return { ok: false, error: 'Unknown request.' };
  const { userId, school } = await requireTenantSession(schoolSlug, [
    'SUPER_ADMIN',
    'SCHOOL_ADMIN',
    'TEACHER',
    'PARENT',
    'STUDENT',
  ]);

  const { data, error } = await createClient()
    .from('leave_requests')
    .update({ status: 'CANCELLED' })
    .eq('id', leaveId)
    .eq('school_id', school.id)
    .eq('requested_by', userId)
    .eq('status', 'PENDING')
    .select('id')
    .maybeSingle();

  if (error || !data) return { ok: false, error: 'Only your own pending requests can be cancelled.' };
  revalidateLeave(schoolSlug);
  return { ok: true, data: { id: data.id } };
}
