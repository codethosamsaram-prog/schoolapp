import type { BusStatus } from '@/types/database';
import { todayInIST } from '@/lib/utils';

/** First of the current month in India, as a date string: "2026-09-01". */
export function thisMonth(): string {
  return `${todayInIST().slice(0, 7)}-01`;
}

/** First of next month: "2026-10-01". */
export function nextMonth(): string {
  const [year, month] = todayInIST().split('-').map(Number);
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "2026-10-01" -> "Oct 2026". Fixed three-letter names to match the fee
 * titles sync_transport_fees() writes with to_char(..., 'Mon YYYY'); Intl's
 * en-IN would say "Sept".
 */
export function monthLabel(month: string): string {
  const [year, value] = month.split('-').map(Number);
  return `${MONTHS[value - 1]} ${year}`;
}

/** "07:10:00" -> "7:10 am". */
export function clockTime(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const suffix = hours >= 12 ? 'pm' : 'am';
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

export const BUS_STATUS_META: Record<BusStatus, { label: string; tone: string }> = {
  ON_SCHEDULE: { label: 'On schedule', tone: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  DELAYED: { label: 'Delayed', tone: 'border-amber-200 bg-amber-50 text-amber-900' },
  NOT_RUNNING: { label: 'Not running today', tone: 'border-rose-200 bg-rose-50 text-rose-800' },
};
