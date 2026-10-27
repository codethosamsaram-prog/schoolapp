import type {
  AttendanceStatus,
  BloodGroup,
  LeadStatus,
  PaymentStatus,
  PayrollMethod,
  StaffRole,
} from '@/types/database';

/** Grades used across Indian K-12 and junior college, in progression order. */
export const CLASS_GRADES = [
  'Nursery', 'LKG', 'UKG',
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII',
] as const;

export type ClassGrade = (typeof CLASS_GRADES)[number];

export const SECTIONS = ['A', 'B', 'C', 'D', 'E'] as const;

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  ADMITTED: 'Admitted',
  REJECTED: 'Rejected',
};

export const LEAD_STATUS_STYLES: Record<LeadStatus, string> = {
  NEW: 'bg-blue-100 text-blue-800 border-blue-200',
  CONTACTED: 'bg-amber-100 text-amber-900 border-amber-200',
  ADMITTED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  REJECTED: 'bg-rose-100 text-rose-800 border-rose-200',
};

export const PAYMENT_STATUS_STYLES: Record<PaymentStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-900 border-amber-200',
  SUCCESS: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  FAILED: 'bg-rose-100 text-rose-800 border-rose-200',
  VOIDED: 'bg-slate-100 text-slate-700 border-slate-300 line-through',
  PARTIALLY_REFUNDED: 'bg-violet-100 text-violet-800 border-violet-200',
  REFUNDED: 'bg-violet-100 text-violet-800 border-violet-300',
};

/** Received and receipted; refunds may since have returned some or all of it. */
export const SETTLED_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'SUCCESS',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
];

export function isSettledPayment(status: PaymentStatus): boolean {
  return SETTLED_PAYMENT_STATUSES.includes(status);
}

/** What the school kept from a payment: nothing unless settled, less refunds. */
export function netPaid(payment: {
  status: PaymentStatus;
  amount_paid: number | string;
  amount_refunded?: number | string | null;
}): number {
  if (!isSettledPayment(payment.status)) return 0;
  return Number(payment.amount_paid) - Number(payment.amount_refunded ?? 0);
}

/** PARTIALLY_REFUNDED reads as "PARTIALLY REFUNDED" on a badge. */
export function paymentStatusLabel(status: PaymentStatus): string {
  return status.replace(/_/g, ' ');
}

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
  EXCUSED_ABSENT: 'On leave',
};

export const LEAD_STATUSES: LeadStatus[] = ['NEW', 'CONTACTED', 'ADMITTED', 'REJECTED'];
export const ATTENDANCE_STATUSES: AttendanceStatus[] = ['PRESENT', 'ABSENT', 'LATE'];

/** Suggestions for subject fields; any other subject name is accepted too. */
export const COMMON_SUBJECTS = [
  'English', 'Hindi', 'Mathematics', 'Science', 'Social Science', 'Physics', 'Chemistry',
  'Biology', 'Computer Science', 'Sanskrit', 'Telugu', 'Kannada', 'Tamil', 'EVS', 'Accountancy',
  'Economics', 'Business Studies', 'History', 'Geography', 'Political Science',
] as const;

/** A family gets at most one WhatsApp fee reminder in this many days. */
export const REMINDER_COOLDOWN_DAYS = 3;

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  TEACHER: 'Teacher',
  ACCOUNTANT: 'Accountant',
  SUPERVISOR: 'Supervisor',
};

export const PAYROLL_METHOD_LABELS: Record<PayrollMethod, string> = {
  DIRECT_TRANSFER: 'Direct transfer',
  CHEQUE: 'Cheque',
  CASH: 'Cash',
};

export const BLOOD_GROUPS: readonly BloodGroup[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
