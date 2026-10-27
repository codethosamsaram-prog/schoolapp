import type { Metadata } from 'next';
import type { PayrollMethod, StaffRole } from '@/types/database';
import { requireTenantSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PAYROLL_METHOD_LABELS, STAFF_ROLE_LABELS } from '@/lib/constants';
import { currentPayMonth, payMonthSchema, periodDate, periodLabel } from '@/lib/payroll';
import { cn, formatINR } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StaffDialog } from './_components/staff-dialog';
import { StaffRowActions } from './_components/staff-row-actions';
import { ProcessAllDialog } from './_components/process-all-dialog';

export const metadata: Metadata = { title: 'Staff & payroll' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { school_slug: string };
  searchParams: { month?: string };
}

const ROLE_STYLES: Record<StaffRole, string> = {
  TEACHER: 'border-sky-200 bg-sky-50 text-sky-800',
  ACCOUNTANT: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  SUPERVISOR: 'border-violet-200 bg-violet-50 text-violet-800',
};

export default async function StaffPage({ params, searchParams }: PageProps) {
  const { school } = await requireTenantSession(params.school_slug, ['SUPER_ADMIN', 'SCHOOL_ADMIN']);
  const month = payMonthSchema.safeParse(searchParams.month).success
    ? (searchParams.month as string)
    : currentPayMonth();
  const monthLabel = periodLabel(periodDate(month));

  const supabase = createClient();
  const [staffResult, slipsResult] = await Promise.all([
    supabase.from('staff').select('*').eq('school_id', school.id).order('full_name'),
    supabase
      .from('payslips')
      .select('id, staff_id, slip_number, gross_pay, total_deductions, net_pay, payment_method')
      .eq('school_id', school.id)
      .eq('period', periodDate(month)),
  ]);
  if (staffResult.error) console.error('[staff] query failed', { error: staffResult.error.message });

  const staff = staffResult.data ?? [];
  const slips = new Map((slipsResult.data ?? []).map((slip) => [slip.staff_id, slip]));
  const active = staff.filter((member) => member.is_active);
  const pending = active.filter((member) => !slips.has(member.id));

  const sum = (values: (string | number)[]) => values.reduce<number>((total, value) => total + Number(value), 0);
  const allSlips = [...slips.values()];
  const totals = {
    gross: sum(allSlips.map((slip) => slip.gross_pay)),
    deductions: sum(allSlips.map((slip) => slip.total_deductions)),
    net: sum(allSlips.map((slip) => slip.net_pay)),
    outstanding: sum(pending.map((member) => member.base_salary)),
  };

  const tiles: [string, string, string?][] = [
    ['Paid', `${slips.size} of ${slips.size + pending.length}`, 'payslips issued'],
    ['Gross pay', formatINR(totals.gross, true)],
    ['Deductions', formatINR(totals.deductions, true)],
    ['Net paid', formatINR(totals.net, true)],
    ['Still to pay', formatINR(totals.outstanding, true), 'at base salary'],
  ];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 lg:px-8 lg:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">Staff &amp; payroll</h1>
          <p className="text-sm text-muted-foreground">
            {active.length} on the payroll · salaries are visible to school admins only
          </p>
        </div>
        <StaffDialog schoolSlug={school.slug} />
      </header>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0 border-b py-4">
          <CardTitle className="text-base">Payroll for {monthLabel}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <form method="get" className="flex items-center gap-2">
              <Input
                type="month"
                name="month"
                defaultValue={month}
                max={currentPayMonth()}
                aria-label="Payroll month"
                className="w-40"
              />
              <Button type="submit" variant="secondary">
                Show
              </Button>
            </form>
            <ProcessAllDialog
              month={month}
              monthLabel={monthLabel}
              pending={pending.map((member) => ({ id: member.id, baseSalary: Number(member.base_salary) }))}
            />
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5" aria-label="Payroll totals">
            {tiles.map(([label, value, note]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
                <dd className="truncate text-lg font-semibold">{value}</dd>
                {note ? <dd className="text-xs text-muted-foreground">{note}</dd> : null}
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {staff.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              No staff yet. Add teachers, accountants and supervisors to run payroll.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff member</TableHead>
                  <TableHead className="hidden md:table-cell">Role</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Base salary</TableHead>
                  <TableHead className="text-right">{monthLabel}</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.map((member) => {
                  const slip = slips.get(member.id);
                  return (
                    <TableRow key={member.id} className={cn(!member.is_active && 'opacity-60')}>
                      <TableCell>
                        <div className="font-medium">
                          {member.full_name}
                          {!member.is_active ? (
                            <Badge variant="outline" className="ml-2 text-[10px]">
                              Off payroll
                            </Badge>
                          ) : null}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {member.employee_code}
                          {member.email ? ` · ${member.email}` : ''}
                          <span className="md:hidden"> · {STAFF_ROLE_LABELS[member.staff_role]}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="flex flex-wrap gap-1">
                          <span
                            className={cn(
                              'rounded-full border px-2 py-0.5 text-xs font-medium',
                              ROLE_STYLES[member.staff_role],
                            )}
                          >
                            {STAFF_ROLE_LABELS[member.staff_role]}
                          </span>
                          {member.departments.map((department) => (
                            <Badge key={department} variant="outline" className="text-[10px] font-normal">
                              {department}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-right sm:table-cell">
                        {formatINR(member.base_salary)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {slip ? (
                          <>
                            <div className="font-semibold text-emerald-700">
                              {formatINR(slip.net_pay, true)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {slip.slip_number} · {PAYROLL_METHOD_LABELS[slip.payment_method as PayrollMethod]}
                            </div>
                          </>
                        ) : member.is_active ? (
                          <span className="text-sm text-amber-700">Not paid</span>
                        ) : (
                          <span className="text-sm text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <StaffRowActions
                          schoolSlug={school.slug}
                          month={month}
                          monthLabel={monthLabel}
                          payslipId={slip?.id ?? null}
                          staff={{
                            id: member.id,
                            fullName: member.full_name,
                            employeeCode: member.employee_code,
                            staffRole: member.staff_role,
                            departments: member.departments,
                            email: member.email,
                            phone: member.phone,
                            dateOfJoining: member.date_of_joining,
                            baseSalary: Number(member.base_salary),
                            bankName: member.bank_name,
                            bankAccountLast4: member.bank_account_last4,
                            isActive: member.is_active,
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
