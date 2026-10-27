import type { LeaveStatus, LeaveType } from '@/types/database';

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  SICK: 'Sick leave',
  CASUAL: 'Casual leave',
  EMERGENCY: 'Emergency leave',
};

export const LEAVE_STATUS_META: Record<LeaveStatus, { label: string; tone: string }> = {
  PENDING: { label: 'Pending', tone: 'border-amber-200 bg-amber-50 text-amber-900' },
  APPROVED: { label: 'Approved', tone: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  REJECTED: { label: 'Rejected', tone: 'border-rose-200 bg-rose-50 text-rose-800' },
  CANCELLED: { label: 'Cancelled', tone: 'border-slate-200 bg-slate-50 text-slate-600' },
};

/** Calendar days in the range, both ends included. */
export function leaveDays(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Longest single application, and how far back one may be made. */
export const MAX_LEAVE_DAYS = 30;
export const MAX_BACKDATE_DAYS = 30;
