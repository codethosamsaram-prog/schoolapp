import 'server-only';

import crypto from 'node:crypto';
import { requireEnv } from '@/lib/env';

/**
 * Signed receipt links.
 *
 * A parent who receives a payment confirmation on WhatsApp is not signed in,
 * so the receipt route cannot rely on a session. Instead the link carries a
 * capability token: an HMAC over the payment id plus an expiry, which grants
 * read access to exactly that one receipt and nothing else.
 */

const DEFAULT_TTL_DAYS = 180;

function sign(payload: string): string {
  return crypto
    .createHmac('sha256', requireEnv('RECEIPT_TOKEN_SECRET'))
    .update(payload, 'utf8')
    .digest('base64url');
}

export function createReceiptToken(paymentId: string, ttlDays = DEFAULT_TTL_DAYS): string {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlDays * 24 * 60 * 60;
  const payload = `${paymentId}.${expiresAt}`;
  return `${expiresAt}.${sign(payload)}`;
}

export function verifyReceiptToken(paymentId: string, token: string | null): boolean {
  if (!token) return false;

  const [expiryPart, signature] = token.split('.');
  if (!expiryPart || !signature) return false;

  const expiresAt = Number(expiryPart);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) return false;

  const expected = sign(`${paymentId}.${expiresAt}`);
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');

  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Path relative to the app origin, used as the WhatsApp CTA URL suffix. */
export function receiptPathSuffix(paymentId: string): string {
  return `receipts/${paymentId}?t=${createReceiptToken(paymentId)}`;
}
