import { z } from 'zod';
import type { PayLine } from '@/types/database';
import { todayInIST } from '@/lib/utils';

/**
 * Payroll helpers shared by the process endpoint, the admin dialog and the
 * payslip PDF. The database recomputes every total on insert
 * (compute_payslip_totals); computePay here is for previews and validation.
 */

/** "2026-09", the month in India right now. */
export function currentPayMonth(): string {
  return todayInIST().slice(0, 7);
}

export const payMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Pick a month')
  .refine((month) => month <= currentPayMonth(), 'Salary cannot be processed for a future month');

/** "2026-09" -> "2026-09-01", the payslips.period value. */
export function periodDate(month: string): string {
  return `${month}-01`;
}

/** "2026-09-01" -> "September 2026". */
export function periodLabel(period: string): string {
  const [year, month] = period.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

/** One slip per person per month, so the number can be derived from both. */
export function slipNumber(month: string, employeeCode: string): string {
  return `PAY-${month.replace('-', '')}-${employeeCode.toUpperCase()}`;
}

export const payLineSchema = z.object({
  label: z.string().trim().min(1, 'Name each line').max(60),
  amount: z.number().positive('Amounts must be more than zero').max(10_00_000),
});

export const payLinesSchema = z.array(payLineSchema).max(20);

export function computePay(basePay: number, additions: PayLine[], deductions: PayLine[]) {
  const round = (value: number) => Math.round(value * 100) / 100;
  const totalAdditions = round(additions.reduce((sum, line) => sum + line.amount, 0));
  const totalDeductions = round(deductions.reduce((sum, line) => sum + line.amount, 0));
  const grossPay = round(basePay + totalAdditions);
  return { totalAdditions, totalDeductions, grossPay, netPay: round(grossPay - totalDeductions) };
}
