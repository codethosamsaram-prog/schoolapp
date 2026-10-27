'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult } from '@/types/database';
import { createClient } from '@/lib/supabase/server';
import { requireTenantSession } from '@/lib/auth';
import { toLocalIndianNumber } from '@/lib/utils';

const optional = (schema: z.ZodString) =>
  z.preprocess((value) => (value === '' || value === null ? undefined : value), schema.optional());

const staffSchema = z.object({
  staffId: z.string().uuid().optional(),
  fullName: z.string().trim().min(2, 'Enter the full name').max(120),
  employeeCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{2,20}$/, '2-20 letters, digits or hyphens')
    .transform((value) => value.toUpperCase()),
  staffRole: z.enum(['TEACHER', 'ACCOUNTANT', 'SUPERVISOR'], { message: 'Pick a role' }),
  departments: z
    .string()
    .optional()
    .transform((value) =>
      [...new Set((value ?? '').split(',').map((tag) => tag.trim()).filter(Boolean))],
    )
    .pipe(z.array(z.string().max(40, 'Keep each department under 40 characters')).max(8, 'At most 8 departments')),
  email: optional(z.string().trim().toLowerCase().email('Enter a valid email')),
  phone: optional(z.string().trim()).transform((value, ctx) => {
    if (!value) return null;
    const local = toLocalIndianNumber(value);
    if (!local) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a 10-digit Indian mobile number' });
      return z.NEVER;
    }
    return local;
  }),
  dateOfJoining: optional(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a valid date')),
  baseSalary: z.coerce
    .number({ invalid_type_error: 'Enter the monthly base salary' })
    .nonnegative('Salary cannot be negative')
    .max(10_00_000),
  bankName: optional(z.string().trim().max(80)),
  bankAccountLast4: optional(z.string().trim().regex(/^\d{4}$/, 'Exactly the last 4 digits')),
});

/** Adds a staff member, or updates one when staffId is given. */
export async function saveStaff(
  schoolSlug: string,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const parsed = staffSchema.safeParse(Object.fromEntries(formData));
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
  const values = {
    full_name: input.fullName,
    employee_code: input.employeeCode,
    staff_role: input.staffRole,
    departments: input.departments,
    email: input.email ?? null,
    phone: input.phone,
    date_of_joining: input.dateOfJoining ?? null,
    base_salary: input.baseSalary,
    bank_name: input.bankName ?? null,
    bank_account_last4: input.bankAccountLast4 ?? null,
  };

  const { data, error } = input.staffId
    ? await supabase
        .from('staff')
        .update(values)
        .eq('id', input.staffId)
        .eq('school_id', school.id)
        .select('id')
        .maybeSingle()
    : await supabase
        .from('staff')
        .insert({ ...values, school_id: school.id })
        .select('id')
        .single();

  if (error || !data) {
    if (error?.code === '23505') {
      return {
        ok: false,
        error: 'That employee code is already in use.',
        fieldErrors: { employeeCode: ['Already in use'] },
      };
    }
    console.error('[staff] save failed', { error: error?.message });
    return { ok: false, error: 'Could not save this staff member. Please try again.' };
  }

  revalidatePath(`/${schoolSlug}/admin/staff`);
  return { ok: true, data: { id: data.id } };
}

/**
 * Takes a staff member off the payroll, or back on. Records are never
 * deleted, because issued payslips refer to them.
 */
export async function setStaffActive(
  schoolSlug: string,
  staffId: string,
  isActive: boolean,
): Promise<ActionResult<{ isActive: boolean }>> {
  if (!z.string().uuid().safeParse(staffId).success) {
    return { ok: false, error: 'Unknown staff member.' };
  }

  const { school } = await requireTenantSession(schoolSlug, ['SUPER_ADMIN', 'SCHOOL_ADMIN']);
  const { data, error } = await createClient()
    .from('staff')
    .update({ is_active: isActive })
    .eq('id', staffId)
    .eq('school_id', school.id)
    .select('is_active')
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: 'Could not update this staff member. Please try again.' };
  }

  revalidatePath(`/${schoolSlug}/admin/staff`);
  return { ok: true, data: { isActive: data.is_active } };
}
