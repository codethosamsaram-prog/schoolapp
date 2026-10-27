import { todayInIST } from '@/lib/utils';

/**
 * Indian academic years run 1 April to 31 March and are labelled
 * '2026-2027', matching public.current_academic_year().
 */

export function academicYearOf(isoDate: string): string {
  const [year, month] = isoDate.split('-').map(Number);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${start + 1}`;
}

export function academicYearRange(label: string): { start: string; end: string } {
  const start = Number(label.slice(0, 4));
  return { start: `${start}-04-01`, end: `${start + 1}-03-31` };
}

/** The current academic year first, then the previous ones. */
export function recentAcademicYears(count = 2): string[] {
  const start = Number(academicYearOf(todayInIST()).slice(0, 4));
  return Array.from({ length: count }, (_, index) => `${start - index}-${start - index + 1}`);
}

export const ACADEMIC_YEAR_PATTERN = /^(\d{4})-(\d{4})$/;
