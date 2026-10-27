import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentProfile } from '@/lib/auth';
import { canManageSchool } from '@/lib/auth-routes';
import { createClient } from '@/lib/supabase/server';
import {
  computePay,
  payLinesSchema,
  payMonthSchema,
  periodDate,
  periodLabel,
  slipNumber,
} from '@/lib/payroll';

/**
 * Processes a month's salary for one or more staff members and issues their
 * payslips.
 *
 *   POST { month: "2026-09", entries: [{ staff_id, additions?, deductions?,
 *          payment_method, payment_reference? }] }
 *
 * Base pay comes from the staff record, never from the request. Runs on the
 * admin's session, so staff and payslip RLS confine it to their own school;
 * the database computes the totals and allows one payslip per person per
 * month, which makes a repeated request harmless: that entry is skipped.
 *
 * Each entry succeeds or is skipped on its own, with a reason. The response
 * is 200 when at least one payslip was issued, 409 when none were.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const entrySchema = z
  .object({
    staff_id: z.string().uuid(),
    additions: payLinesSchema.default([]),
    deductions: payLinesSchema.default([]),
    payment_method: z.enum(['DIRECT_TRANSFER', 'CHEQUE', 'CASH']),
    payment_reference: z.string().trim().min(1).max(60).optional(),
  })
  .refine((entry) => entry.payment_method === 'CASH' || Boolean(entry.payment_reference), {
    message: 'A transfer or cheque needs its UTR or cheque number',
    path: ['payment_reference'],
  });

const bodySchema = z.object({
  month: payMonthSchema,
  entries: z.array(entrySchema).min(1).max(200),
});

interface Processed {
  staff_id: string;
  payslip_id: string;
  slip_number: string;
  net_pay: number;
}

interface Skipped {
  staff_id: string;
  reason: string;
}

export async function POST(request: NextRequest) {
  const current = await getCurrentProfile();
  if (!current) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!canManageSchool(current.profile.role) || !current.profile.is_active) {
    return NextResponse.json({ error: 'Only a school admin can process payroll' }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request body' },
      { status: 400 },
    );
  }

  const { month, entries } = parsed.data;
  const supabase = createClient();

  const { data: staffRows, error: staffError } = await supabase
    .from('staff')
    .select('id, school_id, employee_code, full_name, base_salary, is_active')
    .in(
      'id',
      entries.map((entry) => entry.staff_id),
    );
  if (staffError) {
    console.error('[payroll] staff lookup failed', { error: staffError.message });
    return NextResponse.json({ error: 'Could not load staff records' }, { status: 503 });
  }

  // RLS already limits this to the admin's school; the explicit check keeps a
  // platform operator from mixing tenants in one run.
  const staffById = new Map(
    (staffRows ?? [])
      .filter(
        (row) => current.profile.role === 'SUPER_ADMIN' || row.school_id === current.profile.school_id,
      )
      .map((row) => [row.id, row]),
  );

  const processed: Processed[] = [];
  const skipped: Skipped[] = [];
  const schools = new Set<string>();

  for (const entry of entries) {
    const staff = staffById.get(entry.staff_id);
    if (!staff) {
      skipped.push({ staff_id: entry.staff_id, reason: 'Staff member not found' });
      continue;
    }
    if (!staff.is_active) {
      skipped.push({ staff_id: staff.id, reason: `${staff.full_name} is inactive` });
      continue;
    }

    const pay = computePay(Number(staff.base_salary), entry.additions, entry.deductions);
    if (pay.netPay < 0) {
      skipped.push({ staff_id: staff.id, reason: 'Deductions exceed gross pay' });
      continue;
    }

    const { data: slip, error } = await supabase
      .from('payslips')
      .insert({
        school_id: staff.school_id,
        staff_id: staff.id,
        period: periodDate(month),
        slip_number: slipNumber(month, staff.employee_code),
        base_pay: Number(staff.base_salary),
        additions: entry.additions,
        deductions: entry.deductions,
        payment_method: entry.payment_method,
        payment_reference: entry.payment_method === 'CASH' ? null : entry.payment_reference ?? null,
      })
      .select('id, slip_number, net_pay')
      .single();

    if (error || !slip) {
      const reason =
        error?.code === '23505'
          ? `Already processed for ${periodLabel(periodDate(month))}`
          : error?.code === '22023'
            ? error.message.charAt(0).toUpperCase() + error.message.slice(1)
            : 'Could not issue the payslip';
      if (!error || !['23505', '22023'].includes(error.code)) {
        console.error('[payroll] payslip insert failed', { staffId: staff.id, error: error?.message });
      }
      skipped.push({ staff_id: staff.id, reason });
      continue;
    }

    schools.add(staff.school_id);
    processed.push({
      staff_id: staff.id,
      payslip_id: slip.id,
      slip_number: slip.slip_number,
      net_pay: Number(slip.net_pay),
    });
  }

  if (schools.size > 0) {
    const { data: slugs } = await supabase.from('schools').select('slug').in('id', [...schools]);
    for (const { slug } of slugs ?? []) revalidatePath(`/${slug}/admin/staff`);
  }

  const status = processed.length > 0 ? 200 : 409;
  return NextResponse.json(
    {
      month,
      processed,
      skipped,
      summary: `${processed.length} payslip${processed.length === 1 ? '' : 's'} issued${
        skipped.length ? `, ${skipped.length} skipped` : ''
      }`,
    },
    { status },
  );
}
