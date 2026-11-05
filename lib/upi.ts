/**
 * Direct UPI payments to the school's own UPI ID (VPA): no payment gateway,
 * so no MDR. The family scans a QR in any UPI app, then reports the 12-digit
 * UTR the app shows; the school matches it against its bank statement.
 *
 * Pure functions, no 'server-only': used by the portal QR, the invoice PDF,
 * the claim API and the tests.
 */

/** Same rule as the schools.upi_vpa check constraint. */
export const VPA_PATTERN = /^[A-Za-z0-9._-]{2,255}@[A-Za-z][A-Za-z0-9]{1,63}$/;

/** A UPI transaction reference (UTR / RRN) is exactly 12 digits. */
export const UTR_PATTERN = /^[0-9]{12}$/;

export function isValidVpa(value: string): boolean {
  return VPA_PATTERN.test(value.trim());
}

/** Strips the spaces and dashes people paste along with a UTR. */
export function normaliseUtr(value: string): string {
  return value.replace(/[\s-]/g, '');
}

export function isValidUtr(value: string): boolean {
  return UTR_PATTERN.test(normaliseUtr(value));
}

/**
 * The reference printed on the fee invoice and carried in the UPI
 * transaction note, so the bank statement line names the student:
 * FEE-<admission or roll number>-<academic year, e.g. 2627>.
 */
export function invoiceRef(student: { admissionNumber: string | null; rollNumber: string }, academicYear: string): string {
  const who = (student.admissionNumber || student.rollNumber).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const year = academicYear.replace(/^\d{2}(\d{2})-(\d{2})$/, '$1$2');
  return `FEE-${who}-${year}`.slice(0, 40);
}

export interface UpiIntent {
  vpa: string;
  payeeName: string;
  /** Rupees. Omitted lets the payer type any amount. */
  amount?: number;
  /** Transaction note, shown in the payer's app and on the bank statement. */
  note: string;
}

/**
 * A standard UPI deep link (NPCI UPI linking specification):
 *   upi://pay?pa=<vpa>&pn=<name>&am=<amount>&tn=<note>&cu=INR
 * Any UPI app opens it, and the same string is what the QR encodes.
 */
export function buildUpiUri({ vpa, payeeName, amount, note }: UpiIntent): string {
  if (!isValidVpa(vpa)) throw new Error(`Not a UPI ID: ${vpa}`);
  const params: [string, string][] = [
    ['pa', vpa.trim()],
    ['pn', payeeName.trim().slice(0, 50)],
  ];
  if (amount !== undefined) {
    if (!(amount > 0) || !Number.isFinite(amount)) throw new Error('A UPI amount must be positive');
    params.push(['am', amount.toFixed(2)]);
  }
  params.push(['tn', note.trim().slice(0, 50)], ['cu', 'INR']);
  return `upi://pay?${params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')}`;
}

export interface StatementMatch {
  utr: string;
  /** Every amount-looking number on the statement lines that carry the UTR. */
  amounts: number[];
}

/**
 * Finds UTRs in a bank statement export (CSV or text copied from net
 * banking): every 12-digit run that stands alone, with the amounts on the
 * same line. Banks put the UTR inside narrations like
 * "UPI/434512345678/FEES/...", so it is matched anywhere in the line.
 */
export function parseBankStatement(text: string): Map<string, StatementMatch> {
  const matches = new Map<string, StatementMatch>();
  for (const line of text.split(/\r?\n/)) {
    const utrs = line.match(/(?<!\d)\d{12}(?!\d)/g);
    if (!utrs) continue;
    // "12,500.00" may be one Indian-format amount or two CSV fields, so a
    // token counts both ways; only an exact match against a claim matters.
    const rest = line.replace(/(?<!\d)\d{12}(?!\d)/g, ' ');
    const amounts = (rest.match(/\d[\d,]*(?:\.\d{1,2})?/g) ?? [])
      .flatMap((token) => [token.replace(/,/g, ''), ...token.split(',')])
      .map(Number)
      .filter((value) => Number.isFinite(value) && value > 0);
    for (const utr of utrs) {
      const entry = matches.get(utr) ?? { utr, amounts: [] };
      entry.amounts.push(...amounts);
      matches.set(utr, entry);
    }
  }
  return matches;
}

/** Whether a statement line shows exactly the claimed amount. */
export function statementShowsAmount(match: StatementMatch, amount: number): boolean {
  return match.amounts.some((value) => Math.abs(value - amount) < 0.005);
}
