'use server';

import crypto from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult, LeadStatus } from '@/types/database';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireTenantSession } from '@/lib/auth';
import { USN_PATTERN, studentLoginEmail } from '@/lib/auth-routes';
import { deleteFile, isTenantPath } from '@/lib/storage';
import { appUrl } from '@/lib/env';
import { receiptPathSuffix } from '@/lib/tokens';
import { sendFeeDueReminder, sendPaymentConfirmation } from '@/lib/whatsapp';
import { notifyFamilies, notifyFamily, wasDelivered } from '@/lib/notifications';
import { REMINDER_COOLDOWN_DAYS } from '@/lib/constants';
import { formatINR, toLocalIndianNumber, todayInIST } from '@/lib/utils';

type SessionClient = ReturnType<typeof createClient>;

/**
 * A student's total_fee_due is the sum of their class's fee heads for the
 * current academic year, less their own concession. sync_class_dues re-derives
 * it for a whole class through the caller's RLS; trg_students_fee_change then
 * recalculates each balance.
 */
async function syncClassDues(
  supabase: SessionClient,
  schoolId: string,
  classGrade: string,
): Promise<boolean> {
  const { error } = await supabase.rpc('sync_class_dues', {
    target_school: schoolId,
    target_grade: classGrade,
  });

  if (error) {
    console.error('[admin] could not sync class dues', { classGrade, error: error.message });
    return false;
  }
  return true;
}

function revalidateFeeViews(schoolSlug: string) {
  revalidatePath(`/${schoolSlug}`);
  revalidatePath(`/${schoolSlug}/admin/fees`);
  revalidatePath(`/${schoolSlug}/admin/students`);
  revalidatePath(`/${schoolSlug}/admin/dashboard`);
  revalidatePath(`/${schoolSlug}/portal`);
}

const leadStatusSchema = z.object({
  leadId: z.string().uuid('Unknown lead'),
  status: z.enum(['NEW', 'CONTACTED', 'ADMITTED', 'REJECTED']),
});

/**
 * Moves an admission lead through the pipeline.
 *
 * The update runs on the caller's own Supabase client, so `leads_update_staff`
 * decides whether it is allowed; the explicit school_id filter keeps the
 * statement from ever touching another tenant's row even if a policy is later
 * loosened by mistake.
 */
export async function updateLeadStatus(
  schoolSlug: string,
  leadId: string,
  status: LeadStatus,
): Promise<ActionResult<{ leadId: string; status: LeadStatus }>> {
  const parsed = leadStatusSchema.safeParse({ leadId, status });
  if (!parsed.success) {
    return { ok: false, error: 'That status change is not valid.' };
  }

  const { school } = await requireTenantSession(schoolSlug, ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER']);
  const supabase = createClient();

  const { data, error } = await supabase
    .from('admission_leads')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.leadId)
    .eq('school_id', school.id)
    .select('id, status')
    .maybeSingle();

  if (error) {
    console.error('[admin] lead status update failed', { leadId, error: error.message });
    return { ok: false, error: 'Could not update the lead. Please try again.' };
  }

  if (!data) {
    return { ok: false, error: 'That lead no longer exists.' };
  }

  revalidatePath(`/${schoolSlug}/admin/dashboard`);
  revalidatePath(`/${schoolSlug}/admin/admissions`);

  return { ok: true, data: { leadId: data.id, status: data.status } };
}

const feeStructureSchema = z.object({
  title: z.string().trim().min(2, 'Give the fee head a name').max(120),
  amount: z.coerce.number().nonnegative('Amount cannot be negative').max(10_00_000),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a due date'),
  classGrade: z.string().trim().min(1, 'Pick a class'),
  description: z.string().trim().max(300).optional(),
  feeTypeId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
});

/**
 * Publishes a fee head for a class, or charges it to one student in that
 * class. Class heads appear on the public portal immediately; a student's own
 * head is visible only to staff and that student's family.
 */
export async function upsertFeeStructure(
  schoolSlug: string,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const parsed = feeStructureSchema.safeParse({
    title: formData.get('title'),
    amount: formData.get('amount'),
    dueDate: formData.get('dueDate'),
    classGrade: formData.get('classGrade'),
    description: formData.get('description') || undefined,
    feeTypeId: formData.get('feeTypeId') || undefined,
    studentId: formData.get('studentId') || undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { school } = await requireTenantSession(schoolSlug, ['SUPER_ADMIN', 'SCHOOL_ADMIN']);
  const supabase = createClient();

  const { data: academicYear } = await supabase.rpc('current_academic_year');

  const { data, error } = await supabase
    .from('fee_structures')
    .upsert(
      {
        school_id: school.id,
        title: parsed.data.title,
        amount: parsed.data.amount,
        due_date: parsed.data.dueDate,
        class_grade: parsed.data.classGrade,
        description: parsed.data.description ?? null,
        academic_year: academicYear ?? undefined,
        fee_type_id: parsed.data.feeTypeId ?? null,
        student_id: parsed.data.studentId ?? null,
      },
      { onConflict: 'school_id,academic_year,class_grade,title,student_id' },
    )
    .select('id')
    .single();

  if (error || !data) {
    console.error('[admin] fee structure upsert failed', { error: error?.message });
    return { ok: false, error: 'Could not save this fee head. Please try again.' };
  }

  await syncClassDues(supabase, school.id, parsed.data.classGrade);
  revalidateFeeViews(schoolSlug);

  return { ok: true, data: { id: data.id } };
}

/** Removes a fee head. Payments already made against it keep their amount. */
export async function deleteFeeStructure(
  schoolSlug: string,
  feeStructureId: string,
): Promise<ActionResult<{ id: string }>> {
  if (!z.string().uuid().safeParse(feeStructureId).success) {
    return { ok: false, error: 'Unknown fee head.' };
  }

  const { school } = await requireTenantSession(schoolSlug, ['SUPER_ADMIN', 'SCHOOL_ADMIN']);
  const supabase = createClient();

  const { data, error } = await supabase
    .from('fee_structures')
    .delete()
    .eq('id', feeStructureId)
    .eq('school_id', school.id)
    .select('id, class_grade, academic_year')
    .maybeSingle();

  if (error) {
    console.error('[admin] fee structure delete failed', { feeStructureId, error: error.message });
    return { ok: false, error: 'Could not remove this fee head. Please try again.' };
  }
  if (!data) {
    return { ok: false, error: 'That fee head no longer exists.' };
  }

  await syncClassDues(supabase, school.id, data.class_grade);
  revalidateFeeViews(schoolSlug);

  return { ok: true, data: { id: data.id } };
}

const studentSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter the student name').max(120),
  rollNumber: z.string().trim().min(1, 'Enter a roll number').max(20),
  admissionNumber: z.string().trim().max(40).optional(),
  classGrade: z.string().trim().min(1, 'Pick a class'),
  section: z.string().trim().min(1, 'Pick a section').max(5),
  parentName: z.string().trim().min(2, 'Enter the parent name').max(120),
  parentPhone: z
    .string()
    .trim()
    .transform((value, ctx) => {
      const local = toLocalIndianNumber(value);
      if (!local) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Enter a 10-digit Indian mobile number',
        });
        return z.NEVER;
      }
      return local;
    }),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a valid date')
    .optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
  usn: z
    .string()
    .trim()
    .regex(USN_PATTERN, '3-20 letters, digits or hyphens')
    .transform((value) => value.toUpperCase())
    .optional(),
  leadId: z.string().uuid().optional(),
});

/**
 * Enrols a student. Their total_fee_due starts at the sum of the class's fee
 * heads for the current academic year.
 *
 * With a leadId, the student is enrolled from an ADMITTED enquiry and the lead
 * records which student it became, so it cannot be enrolled twice.
 */
export async function createStudent(
  schoolSlug: string,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const parsed = studentSchema.safeParse({
    fullName: formData.get('fullName'),
    rollNumber: formData.get('rollNumber'),
    admissionNumber: formData.get('admissionNumber') || undefined,
    classGrade: formData.get('classGrade'),
    section: formData.get('section'),
    parentName: formData.get('parentName'),
    parentPhone: formData.get('parentPhone'),
    dateOfBirth: formData.get('dateOfBirth') || undefined,
    gender: formData.get('gender') || undefined,
    bloodGroup: formData.get('bloodGroup') || undefined,
    usn: formData.get('usn') || undefined,
    leadId: formData.get('leadId') || undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { school } = await requireTenantSession(schoolSlug, ['SUPER_ADMIN', 'SCHOOL_ADMIN']);
  const supabase = createClient();
  const { leadId } = parsed.data;

  if (leadId) {
    const { data: lead } = await supabase
      .from('admission_leads')
      .select('id, status, student_id')
      .eq('id', leadId)
      .eq('school_id', school.id)
      .maybeSingle();

    if (!lead || lead.status !== 'ADMITTED') {
      return { ok: false, error: 'Only an admitted enquiry can be enrolled.' };
    }
    if (lead.student_id) {
      return { ok: false, error: 'This enquiry has already been enrolled.' };
    }
  }

  const { data: academicYear } = await supabase.rpc('current_academic_year');
  const { data: heads } = await supabase
    .from('fee_structures')
    .select('amount')
    .eq('school_id', school.id)
    .eq('class_grade', parsed.data.classGrade)
    .eq('academic_year', academicYear ?? '');

  const totalFeeDue = (heads ?? []).reduce((sum, head) => sum + Number(head.amount), 0);

  const { data, error } = await supabase
    .from('students')
    .insert({
      school_id: school.id,
      full_name: parsed.data.fullName,
      roll_number: parsed.data.rollNumber,
      admission_number: parsed.data.admissionNumber ?? null,
      class_grade: parsed.data.classGrade,
      section: parsed.data.section,
      parent_name: parsed.data.parentName,
      parent_phone: parsed.data.parentPhone,
      date_of_birth: parsed.data.dateOfBirth ?? null,
      gender: parsed.data.gender ?? null,
      blood_group: parsed.data.bloodGroup ?? null,
      usn: parsed.data.usn ?? null,
      total_fee_due: totalFeeDue,
    })
    .select('id')
    .single();

  if (error || !data) {
    if (error?.code === '23505') {
      if (error.message.includes('students_usn_unique')) {
        return {
          ok: false,
          error: 'That USN already belongs to another student.',
          fieldErrors: { usn: ['Already in use'] },
        };
      }
      return {
        ok: false,
        error: 'That roll number is already taken in this class and section.',
        fieldErrors: { rollNumber: ['Already taken in this class and section'] },
      };
    }
    console.error('[admin] student insert failed', { error: error?.message });
    return { ok: false, error: 'Could not enrol this student. Please try again.' };
  }

  if (leadId) {
    // The student exists either way; a failed link only means the lead keeps
    // offering the Enrol button, which the unique index would then refuse.
    const { error: linkError } = await supabase
      .from('admission_leads')
      .update({ student_id: data.id })
      .eq('id', leadId)
      .eq('school_id', school.id)
      .is('student_id', null);

    if (linkError) {
      console.error('[admin] lead link failed', { leadId, error: linkError.message });
    }
    revalidatePath(`/${schoolSlug}/admin/admissions`);
  }

  revalidatePath(`/${schoolSlug}/admin/students`);
  revalidatePath(`/${schoolSlug}/admin/dashboard`);
  revalidatePath(`/${schoolSlug}/teacher/attendance`);

  return { ok: true, data: { id: data.id } };
}

/** Withdraws or re-admits a student. Records are kept for the ledger. */
export async function setStudentActive(
  schoolSlug: string,
  studentId: string,
  isActive: boolean,
): Promise<ActionResult<{ id: string; isActive: boolean }>> {
  if (!z.string().uuid().safeParse(studentId).success) {
    return { ok: false, error: 'Unknown student.' };
  }

  const { school } = await requireTenantSession(schoolSlug, ['SUPER_ADMIN', 'SCHOOL_ADMIN']);
  const supabase = createClient();

  const { data, error } = await supabase
    .from('students')
    .update({ is_active: isActive })
    .eq('id', studentId)
    .eq('school_id', school.id)
    .select('id, is_active')
    .maybeSingle();

  if (error || !data) {
    console.error('[admin] student status update failed', { studentId, error: error?.message });
    return { ok: false, error: 'Could not update this student. Please try again.' };
  }

  revalidatePath(`/${schoolSlug}/admin/students`);
  revalidatePath(`/${schoolSlug}/admin/dashboard`);
  revalidatePath(`/${schoolSlug}/teacher/attendance`);

  return { ok: true, data: { id: data.id, isActive: data.is_active } };
}

const parentAccountSchema = z.object({
  studentId: z.string().uuid('Unknown student'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
});

/** 12 characters of base64url: 72 bits of entropy. */
function temporaryPassword(): string {
  return crypto.randomBytes(9).toString('base64url');
}

/**
 * Gives a student's parent a portal login, or links an existing parent login
 * to another child (siblings share one account).
 *
 * Creating an auth user needs the service role. The tenant and the PARENT
 * role travel in app_metadata, which handle_new_user trusts and no client can
 * set on itself. Linking the child then runs on the admin's own session, so
 * students_update_admin still decides whether it is allowed.
 */
export async function provisionParentAccount(
  schoolSlug: string,
  formData: FormData,
): Promise<ActionResult<{ email: string; temporaryPassword: string | null }>> {
  const parsed = parentAccountSchema.safeParse({
    studentId: formData.get('studentId'),
    email: formData.get('email'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { school } = await requireTenantSession(schoolSlug, ['SUPER_ADMIN', 'SCHOOL_ADMIN']);
  const supabase = createClient();

  const { data: student, error: studentError } = await supabase
    .from('students')
    .select('id, parent_name, parent_phone')
    .eq('id', parsed.data.studentId)
    .eq('school_id', school.id)
    .maybeSingle();

  if (studentError || !student) {
    return { ok: false, error: 'That student is not on your roll.' };
  }

  const admin = createAdminClient();
  const { email } = parsed.data;

  const { data: existing, error: lookupError } = await admin
    .from('profiles')
    .select('id, role, school_id')
    .eq('email', email)
    .maybeSingle();

  if (lookupError) {
    console.error('[admin] parent lookup failed', { error: lookupError.message });
    return { ok: false, error: 'Could not look up that email. Please try again.' };
  }

  let parentUserId: string;
  let password: string | null = null;

  if (existing) {
    if (existing.role !== 'PARENT' || existing.school_id !== school.id) {
      return {
        ok: false,
        error: 'That email already belongs to another account.',
        fieldErrors: { email: ['Already in use by a non-parent account'] },
      };
    }
    parentUserId = existing.id;
  } else {
    password = temporaryPassword();
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role: 'PARENT', school_id: school.id, must_change_password: true },
      user_metadata: { full_name: student.parent_name ?? '', phone: student.parent_phone },
    });

    if (createError || !created.user) {
      console.error('[admin] parent account creation failed', { error: createError?.message });
      return { ok: false, error: 'Could not create the parent login. Please try again.' };
    }
    parentUserId = created.user.id;
  }

  const { error: linkError } = await supabase
    .from('students')
    .update({ parent_user_id: parentUserId })
    .eq('id', student.id)
    .eq('school_id', school.id);

  if (linkError) {
    console.error('[admin] parent link failed', { studentId: student.id, error: linkError.message });
    return { ok: false, error: 'The login exists but could not be linked. Please try again.' };
  }

  revalidatePath(`/${schoolSlug}/admin/students`);

  return { ok: true, data: { email, temporaryPassword: password } };
}

const concessionSchema = z.object({
  studentId: z.string().uuid('Unknown student'),
  amount: z.coerce.number().nonnegative('Concession cannot be negative').max(10_00_000),
  note: z.string().trim().max(200).optional(),
});

/**
 * Sets a standing reduction on one student's annual dues. Stored separately
 * from total_fee_due so that re-syncing the class after a schedule change
 * keeps it. Zero clears it.
 */
export async function setFeeConcession(
  schoolSlug: string,
  formData: FormData,
): Promise<ActionResult<{ totalFeeDue: number; balance: number }>> {
  const parsed = concessionSchema.safeParse({
    studentId: formData.get('studentId'),
    amount: formData.get('amount'),
    note: formData.get('note') || undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { school } = await requireTenantSession(schoolSlug, ['SUPER_ADMIN', 'SCHOOL_ADMIN']);
  const supabase = createClient();
  const { studentId, amount, note } = parsed.data;

  const { data: student, error } = await supabase
    .from('students')
    .update({ fee_concession: amount, fee_concession_note: amount > 0 ? note ?? null : null })
    .eq('id', studentId)
    .eq('school_id', school.id)
    .select('class_grade')
    .maybeSingle();

  if (error || !student) {
    console.error('[admin] concession update failed', { studentId, error: error?.message });
    return { ok: false, error: 'Could not save the concession. Please try again.' };
  }

  if (!(await syncClassDues(supabase, school.id, student.class_grade))) {
    return { ok: false, error: 'Concession saved, but dues could not be recalculated.' };
  }

  const { data: updated } = await supabase
    .from('students')
    .select('total_fee_due, current_balance')
    .eq('id', studentId)
    .single();

  revalidateFeeViews(schoolSlug);

  return {
    ok: true,
    data: {
      totalFeeDue: Number(updated?.total_fee_due ?? 0),
      balance: Number(updated?.current_balance ?? 0),
    },
  };
}

const OFFLINE_METHODS = {
  CASH: 'Cash',
  CHEQUE: 'Cheque',
  DD: 'Demand draft',
  BANK_TRANSFER: 'Bank transfer',
} as const;

export type OfflineMethod = keyof typeof OFFLINE_METHODS;

const offlinePaymentSchema = z
  .object({
    studentId: z.string().uuid('Unknown student'),
    amount: z.coerce.number().positive('Enter the amount received').max(10_00_000),
    method: z.enum(['CASH', 'CHEQUE', 'DD', 'BANK_TRANSFER']),
    reference: z.string().trim().max(60).optional(),
    paidOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date received')
      .refine((value) => value <= todayInIST(), 'The date cannot be in the future'),
    notes: z.string().trim().max(200).optional(),
  })
  .refine((value) => value.method === 'CASH' || Boolean(value.reference), {
    path: ['reference'],
    message: 'Enter the cheque, DD or transaction number',
  });

/**
 * Records fees collected at the school office: cash, cheque, demand draft or
 * a direct bank transfer.
 *
 * This is the one path besides the Razorpay webhook that writes a SUCCESS
 * payment, and it is limited to school admins by both requireTenantSession
 * and fee_payments_insert_admin. It allocates a receipt number the same way
 * the webhook does, so offline and online receipts share one sequence, and
 * trg_fee_payments_balance moves the balance.
 */
export async function recordOfflinePayment(
  schoolSlug: string,
  formData: FormData,
): Promise<ActionResult<{ paymentId: string; receiptNumber: string; whatsappDelivered: boolean }>> {
  const parsed = offlinePaymentSchema.safeParse({
    studentId: formData.get('studentId'),
    amount: formData.get('amount'),
    method: formData.get('method'),
    reference: formData.get('reference') || undefined,
    paidOn: formData.get('paidOn'),
    notes: formData.get('notes') || undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { school } = await requireTenantSession(schoolSlug, ['SUPER_ADMIN', 'SCHOOL_ADMIN']);
  const supabase = createClient();
  const input = parsed.data;

  const { data: student, error: studentError } = await supabase
    .from('students')
    .select('id, full_name, parent_name, parent_phone, current_balance')
    .eq('id', input.studentId)
    .eq('school_id', school.id)
    .maybeSingle();

  if (studentError || !student) {
    return { ok: false, error: 'That student is not on your roll.' };
  }

  const balance = Number(student.current_balance);
  if (input.amount > balance) {
    return {
      ok: false,
      error: `That is more than the ${formatINR(balance)} outstanding.`,
      fieldErrors: { amount: [`At most ${formatINR(balance)}`] },
    };
  }

  const { data: receiptNumber, error: receiptError } = await supabase.rpc('next_receipt_number', {
    target_school: school.id,
  });

  if (receiptError || !receiptNumber) {
    console.error('[admin] receipt number allocation failed', { error: receiptError?.message });
    return { ok: false, error: 'Could not allocate a receipt number. Please try again.' };
  }

  const label = OFFLINE_METHODS[input.method];

  const { data: payment, error: insertError } = await supabase
    .from('fee_payments')
    .insert({
      school_id: school.id,
      student_id: student.id,
      amount_paid: input.amount,
      payment_method: input.reference ? `${label} (${input.reference})` : label,
      status: 'SUCCESS',
      receipt_number: receiptNumber,
      // Printed as the receipt's line item when no fee head is attached.
      notes: input.notes ?? 'Fee payment',
      // Midday IST, so the date reads the same in every timezone.
      paid_at: `${input.paidOn}T12:00:00+05:30`,
    })
    .select('id')
    .single();

  if (insertError || !payment) {
    console.error('[admin] offline payment insert failed', { error: insertError?.message });
    return { ok: false, error: 'Could not record this payment. Please try again.' };
  }

  // The money is recorded from here on; the signed link and the WhatsApp
  // confirmation are best effort and must not report the payment as failed.
  let whatsappDelivered = false;
  try {
    const suffix = receiptPathSuffix(payment.id);

    await supabase
      .from('fee_payments')
      .update({ receipt_url: appUrl(`/${suffix}`) })
      .eq('id', payment.id)
      .eq('school_id', school.id);

    const outstanding = formatINR(Math.max(balance - input.amount, 0), true);
    const notification = await notifyFamily({
      schoolId: school.id,
      studentId: student.id,
      type: 'FEE',
      title: 'Payment received',
      body: `${formatINR(input.amount, true)} received for ${student.full_name}. Receipt ${receiptNumber}. Outstanding: ${outstanding}.`,
      link: `/${school.slug}/portal/fees`,
      whatsapp: () =>
        sendPaymentConfirmation({
          parentPhone: student.parent_phone,
          parentName: student.parent_name ?? 'Parent',
          studentName: student.full_name,
          schoolName: school.name,
          amountPaid: formatINR(input.amount, true),
          receiptNumber,
          outstandingBalance: outstanding,
          receiptPathSuffix: suffix,
        }),
    });
    whatsappDelivered = Boolean(notification.whatsapp?.ok);
  } catch (error) {
    console.error('[admin] offline payment recorded, confirmation skipped', {
      paymentId: payment.id,
      reason: error instanceof Error ? error.message : 'unknown',
    });
  }

  revalidateFeeViews(schoolSlug);

  return { ok: true, data: { paymentId: payment.id, receiptNumber, whatsappDelivered } };
}

const studentLoginSchema = z.object({
  studentId: z.string().uuid('Unknown student'),
  usn: z
    .string()
    .trim()
    .regex(USN_PATTERN, '3-20 letters, digits or hyphens')
    .transform((value) => value.toUpperCase()),
});

/**
 * Creates a student's own login, or resets it. The student signs in with
 * their USN (mapped to an internal login email for this school) and a
 * one-time password, and must choose their own at first sign-in.
 */
export async function provisionStudentLogin(
  schoolSlug: string,
  formData: FormData,
): Promise<ActionResult<{ usn: string; temporaryPassword: string; reset: boolean }>> {
  const parsed = studentLoginSchema.safeParse({
    studentId: formData.get('studentId'),
    usn: formData.get('usn'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { school } = await requireTenantSession(schoolSlug, ['SUPER_ADMIN', 'SCHOOL_ADMIN']);
  const supabase = createClient();
  const { studentId, usn } = parsed.data;

  const { data: student, error: studentError } = await supabase
    .from('students')
    .update({ usn })
    .eq('id', studentId)
    .eq('school_id', school.id)
    .select('id, full_name, user_id')
    .maybeSingle();

  if (studentError || !student) {
    if (studentError?.code === '23505') {
      return {
        ok: false,
        error: 'That USN already belongs to another student.',
        fieldErrors: { usn: ['Already in use'] },
      };
    }
    return { ok: false, error: 'That student is not on your roll.' };
  }

  const admin = createAdminClient();
  const email = studentLoginEmail(school.slug, usn);
  const password = temporaryPassword();

  if (student.user_id) {
    const { data: existing } = await admin.auth.admin.getUserById(student.user_id);
    const { error: resetError } = await admin.auth.admin.updateUserById(student.user_id, {
      email,
      password,
      email_confirm: true,
      app_metadata: { ...(existing.user?.app_metadata ?? {}), must_change_password: true },
    });
    if (resetError) {
      console.error('[admin] student login reset failed', { error: resetError.message });
      return { ok: false, error: 'Could not reset the student login. Please try again.' };
    }
    await admin
      .from('profiles')
      .update({ must_change_password: true, email })
      .eq('id', student.user_id)
      .eq('school_id', school.id);

    revalidatePath(`/${schoolSlug}/admin/students`);
    return { ok: true, data: { usn, temporaryPassword: password, reset: true } };
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: 'STUDENT', school_id: school.id, must_change_password: true },
    user_metadata: { full_name: student.full_name },
  });

  if (createError || !created.user) {
    console.error('[admin] student login creation failed', { error: createError?.message });
    return {
      ok: false,
      error: /already been registered/i.test(createError?.message ?? '')
        ? 'A login with that USN already exists at this school.'
        : 'Could not create the student login. Please try again.',
    };
  }

  const { error: linkError } = await supabase
    .from('students')
    .update({ user_id: created.user.id })
    .eq('id', student.id)
    .eq('school_id', school.id);

  if (linkError) {
    console.error('[admin] student login link failed', { error: linkError.message });
    return { ok: false, error: 'The login exists but could not be linked. Please try again.' };
  }

  revalidatePath(`/${schoolSlug}/admin/students`);
  return { ok: true, data: { usn, temporaryPassword: password, reset: false } };
}

/**
 * Points a student at a photo the browser has already uploaded to the private
 * avatars bucket. Storage RLS decided whether that upload was allowed; this
 * only accepts a path under this tenant and this student.
 */
export async function setStudentPhoto(
  schoolSlug: string,
  studentId: string,
  path: string | null,
): Promise<ActionResult<{ path: string | null }>> {
  if (!z.string().uuid().safeParse(studentId).success) {
    return { ok: false, error: 'Unknown student.' };
  }

  const { school } = await requireTenantSession(schoolSlug, ['SUPER_ADMIN', 'SCHOOL_ADMIN']);

  if (path && (!isTenantPath(path, school.id) || !path.startsWith(`${school.id}/${studentId}-`))) {
    return { ok: false, error: 'That photo was not uploaded for this student.' };
  }

  const supabase = createClient();
  const { data: previous } = await supabase
    .from('students')
    .select('avatar_url')
    .eq('id', studentId)
    .eq('school_id', school.id)
    .maybeSingle();

  const { error } = await supabase
    .from('students')
    .update({ avatar_url: path })
    .eq('id', studentId)
    .eq('school_id', school.id);

  if (error) {
    console.error('[admin] photo link failed', { studentId, error: error.message });
    return { ok: false, error: 'Could not save the photo. Please try again.' };
  }

  if (previous?.avatar_url && previous.avatar_url !== path) {
    await deleteFile('avatars', [previous.avatar_url]);
  }

  revalidatePath(`/${schoolSlug}/admin/students`);
  revalidatePath(`/${schoolSlug}/teacher/attendance`);
  revalidatePath(`/${schoolSlug}/portal`, 'layout');

  return { ok: true, data: { path } };
}

const feeTypeSchema = z.object({
  name: z.string().trim().min(2, 'Name the category').max(40),
});

/** Adds a custom fee category next to Tuition, Exam and Bus. */
export async function createFeeType(
  schoolSlug: string,
  formData: FormData,
): Promise<ActionResult<{ id: string; name: string }>> {
  const parsed = feeTypeSchema.safeParse({ name: formData.get('name') });
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { school } = await requireTenantSession(schoolSlug, ['SUPER_ADMIN', 'SCHOOL_ADMIN']);
  const supabase = createClient();

  const { data, error } = await supabase
    .from('fee_types')
    .insert({ school_id: school.id, name: parsed.data.name })
    .select('id, name')
    .single();

  if (error || !data) {
    if (error?.code === '23505') {
      return { ok: false, error: 'That category already exists.', fieldErrors: { name: ['Already exists'] } };
    }
    console.error('[admin] fee type insert failed', { error: error?.message });
    return { ok: false, error: 'Could not add the category. Please try again.' };
  }

  revalidatePath(`/${schoolSlug}/admin/fees`);
  return { ok: true, data };
}

/** Removes a custom category; its fee heads fall back to "Custom". */
export async function deleteFeeType(
  schoolSlug: string,
  feeTypeId: string,
): Promise<ActionResult<{ id: string }>> {
  if (!z.string().uuid().safeParse(feeTypeId).success) {
    return { ok: false, error: 'Unknown category.' };
  }

  const { school } = await requireTenantSession(schoolSlug, ['SUPER_ADMIN', 'SCHOOL_ADMIN']);
  const supabase = createClient();

  const { data, error } = await supabase
    .from('fee_types')
    .delete()
    .eq('id', feeTypeId)
    .eq('school_id', school.id)
    .select('id')
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: 'Standard categories cannot be removed.' };
  }

  revalidateFeeViews(schoolSlug);
  return { ok: true, data: { id: data.id } };
}

const studentUpdateSchema = studentSchema
  .omit({ usn: true, leadId: true })
  .extend({ studentId: z.string().uuid('Unknown student') });

/**
 * Corrects a student's details. Moving class carries the student's own fee
 * heads for the current year across and re-derives their dues from the new
 * class's schedule.
 */
export async function updateStudent(
  schoolSlug: string,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const parsed = studentUpdateSchema.safeParse({
    studentId: formData.get('studentId'),
    fullName: formData.get('fullName'),
    rollNumber: formData.get('rollNumber'),
    admissionNumber: formData.get('admissionNumber') || undefined,
    classGrade: formData.get('classGrade'),
    section: formData.get('section'),
    parentName: formData.get('parentName'),
    parentPhone: formData.get('parentPhone'),
    dateOfBirth: formData.get('dateOfBirth') || undefined,
    gender: formData.get('gender') || undefined,
    bloodGroup: formData.get('bloodGroup') || undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { school } = await requireTenantSession(schoolSlug, ['SUPER_ADMIN', 'SCHOOL_ADMIN']);
  const supabase = createClient();
  const input = parsed.data;

  const { data: current } = await supabase
    .from('students')
    .select('id, class_grade, is_active')
    .eq('id', input.studentId)
    .eq('school_id', school.id)
    .maybeSingle();

  if (!current) {
    return { ok: false, error: 'That student is not on your roll.' };
  }

  const { error } = await supabase
    .from('students')
    .update({
      full_name: input.fullName,
      roll_number: input.rollNumber,
      admission_number: input.admissionNumber ?? null,
      class_grade: input.classGrade,
      section: input.section,
      parent_name: input.parentName,
      parent_phone: input.parentPhone,
      date_of_birth: input.dateOfBirth ?? null,
      gender: input.gender ?? null,
      blood_group: input.bloodGroup ?? null,
    })
    .eq('id', current.id)
    .eq('school_id', school.id);

  if (error) {
    if (error.code === '23505') {
      return {
        ok: false,
        error: 'That roll number is already taken in this class and section.',
        fieldErrors: { rollNumber: ['Already taken in this class and section'] },
      };
    }
    console.error('[admin] student update failed', { studentId: current.id, error: error.message });
    return { ok: false, error: 'Could not save these details. Please try again.' };
  }

  if (current.class_grade !== input.classGrade) {
    const { data: academicYear } = await supabase.rpc('current_academic_year');

    // trg_fee_structures_tenant accepts this only now that the student is in
    // the new class.
    const { error: headsError } = await supabase
      .from('fee_structures')
      .update({ class_grade: input.classGrade })
      .eq('school_id', school.id)
      .eq('student_id', current.id)
      .eq('academic_year', academicYear ?? '');

    if (headsError) {
      console.error('[admin] personal fee heads not moved', {
        studentId: current.id,
        error: headsError.message,
      });
    }

    if (current.is_active && !(await syncClassDues(supabase, school.id, input.classGrade))) {
      return {
        ok: false,
        error: 'Details saved, but dues for the new class could not be recalculated.',
      };
    }
    revalidateFeeViews(schoolSlug);
  }

  revalidatePath(`/${schoolSlug}/admin/students`);
  revalidatePath(`/${schoolSlug}/teacher/attendance`);
  revalidatePath(`/${schoolSlug}/portal`, 'layout');

  return { ok: true, data: { id: current.id } };
}

const voidPaymentSchema = z.object({
  paymentId: z.string().uuid('Unknown payment'),
  reason: z.string().trim().min(3, 'Say why this receipt is being voided').max(200),
});

/**
 * Voids a receipt issued at the office in error. The row and its receipt
 * number stay in the ledger; trg_fee_payments_balance restores the balance
 * because only SUCCESS rows count. guard_payment_void refuses online
 * payments, which are refunded through Razorpay, and makes the void final.
 */
export async function voidOfflinePayment(
  schoolSlug: string,
  formData: FormData,
): Promise<ActionResult<{ receiptNumber: string | null }>> {
  const parsed = voidPaymentSchema.safeParse({
    paymentId: formData.get('paymentId'),
    reason: formData.get('reason'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { school } = await requireTenantSession(schoolSlug, ['SUPER_ADMIN', 'SCHOOL_ADMIN']);
  const supabase = createClient();

  const { data, error } = await supabase
    .from('fee_payments')
    .update({ status: 'VOIDED', void_reason: parsed.data.reason })
    .eq('id', parsed.data.paymentId)
    .eq('school_id', school.id)
    .eq('status', 'SUCCESS')
    .is('razorpay_payment_id', null)
    .select('receipt_number')
    .maybeSingle();

  if (error || !data) {
    if (error) {
      console.error('[admin] void failed', { paymentId: parsed.data.paymentId, error: error.message });
    }
    return {
      ok: false,
      error: 'Only a settled office payment can be voided. Refund online payments from Razorpay.',
    };
  }

  revalidateFeeViews(schoolSlug);
  return { ok: true, data: { receiptNumber: data.receipt_number } };
}

const REMINDER_BATCH_LIMIT = 500;

const reminderSchema = z.object({ classGrade: z.string().trim().max(20).optional() });

/**
 * Reminds the family of every active student with a balance, optionally for
 * one class: in the portal for families with a login, by the
 * fee_due_reminder WhatsApp template for the rest (lib/notifications.ts).
 * Families reminded in the last REMINDER_COOLDOWN_DAYS are skipped, so a
 * repeated click is harmless.
 */
export async function sendFeeReminders(
  schoolSlug: string,
  formData: FormData,
): Promise<
  ActionResult<{ sent: number; failed: number; recentlyReminded: number; inApp: number; whatsapp: number }>
> {
  const parsed = reminderSchema.safeParse({
    classGrade: formData.get('classGrade') || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: 'Unknown class.' };
  }

  const { school } = await requireTenantSession(schoolSlug, ['SUPER_ADMIN', 'SCHOOL_ADMIN']);

  const supabase = createClient();
  const cutoff = Date.now() - REMINDER_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

  let request = supabase
    .from('students')
    .select('id, full_name, parent_name, parent_phone, current_balance, last_fee_reminder_at')
    .eq('school_id', school.id)
    .eq('is_active', true)
    .gt('current_balance', 0)
    .limit(REMINDER_BATCH_LIMIT);
  if (parsed.data.classGrade) request = request.eq('class_grade', parsed.data.classGrade);

  const { data: owing, error } = await request;
  if (error) {
    console.error('[admin] reminder query failed', { error: error.message });
    return { ok: false, error: 'Could not load outstanding balances. Please try again.' };
  }

  const due = (owing ?? []).filter(
    (student) =>
      !student.last_fee_reminder_at || Date.parse(student.last_fee_reminder_at) < cutoff,
  );
  const recentlyReminded = (owing ?? []).length - due.length;

  const outcomes = await notifyFamilies(
    due.map((student) => ({
      schoolId: school.id,
      studentId: student.id,
      type: 'FEE' as const,
      title: 'Fee payment due',
      body: `${formatINR(student.current_balance, true)} is outstanding towards fees for ${student.full_name}. You can pay from the portal.`,
      link: `/${school.slug}/portal/fees`,
      whatsapp: () =>
        sendFeeDueReminder({
          parentPhone: student.parent_phone,
          parentName: student.parent_name ?? 'Parent',
          studentName: student.full_name,
          schoolName: school.name,
          outstandingBalance: formatINR(student.current_balance, true),
          portalPathSuffix: `${school.slug}/portal/fees`,
        }),
    })),
  );

  const delivered = due.filter((_, index) => wasDelivered(outcomes[index])).map((student) => student.id);
  const failed = due.length - delivered.length;
  const inApp = outcomes.filter((outcome) => outcome.inApp > 0).length;
  const whatsapp = outcomes.filter((outcome) => outcome.whatsapp?.ok).length;

  if (delivered.length > 0) {
    const { error: stampError } = await supabase
      .from('students')
      .update({ last_fee_reminder_at: new Date().toISOString() })
      .eq('school_id', school.id)
      .in('id', delivered);

    if (stampError) {
      console.error('[admin] reminder timestamps not saved', { error: stampError.message });
    }
  }

  revalidatePath(`/${schoolSlug}/admin/fees`);

  return { ok: true, data: { sent: delivered.length, failed, recentlyReminded, inApp, whatsapp } };
}
