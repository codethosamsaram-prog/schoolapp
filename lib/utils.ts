import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const INR_PRECISE = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Indian-grouped currency, e.g. 1,02,000. */
export function formatINR(amount: number | string | null | undefined, precise = false): string {
  const value = typeof amount === 'string' ? Number(amount) : amount ?? 0;
  if (!Number.isFinite(value)) return precise ? INR_PRECISE.format(0) : INR.format(0);
  return precise ? INR_PRECISE.format(value) : INR.format(value);
}

/** Compact Indian notation for KPI tiles: 12.4L, 1.2Cr. */
export function formatCompactINR(amount: number | null | undefined): string {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value)) return '0';
  const abs = Math.abs(value);
  if (abs >= 1_00_00_000) return `${(value / 1_00_00_000).toFixed(2)} Cr`;
  if (abs >= 1_00_000) return `${(value / 1_00_000).toFixed(2)} L`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)} K`;
  return value.toFixed(0);
}

export function formatDate(
  value: string | Date | null | undefined,
  opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' },
): string {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...opts }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  return formatDate(value, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** YYYY-MM-DD in IST, which is the day boundary attendance is keyed on. */
export function todayInIST(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return parts;
}

/**
 * Normalises Indian mobile numbers to E.164 without the plus, as the WhatsApp
 * Cloud API expects. Accepts 9810012345, 09810012345, +91 98100 12345.
 */
export function toE164India(phone: string, countryCode = '91'): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `${countryCode}${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `${countryCode}${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith(countryCode)) return digits;
  if (digits.length === 13 && digits.startsWith(`0${countryCode}`)) return digits.slice(1);
  return null;
}

/** Last ten digits, which is what the students and leads tables store. */
export function toLocalIndianNumber(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  const local = digits.slice(-10);
  return /^[6-9]\d{9}$/.test(local) ? local : null;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function percent(numerator: number, denominator: number, digits = 1): string {
  if (!denominator) return '0%';
  return `${((numerator / denominator) * 100).toFixed(digits)}%`;
}
