import 'server-only';

import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { requireEnv } from '@/lib/env';

/**
 * Razorpay integration.
 *
 * Money crosses this boundary in paise (integer), and is stored in rupees
 * (numeric(12,2)) everywhere else in the system. The two conversion helpers
 * below are the only place that distinction is allowed to live.
 */

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: number): number {
  return Math.round(paise) / 100;
}

let client: Razorpay | null = null;

export function razorpayClient(): Razorpay {
  if (client) return client;
  client = new Razorpay({
    key_id: requireEnv('RAZORPAY_KEY_ID'),
    key_secret: requireEnv('RAZORPAY_KEY_SECRET'),
  });
  pointAtTestGateway(client);
  return client;
}

/**
 * RAZORPAY_API_BASE_URL sends SDK calls to a stand-in gateway, which is how
 * the e2e suite exercises refunds without real money. The SDK hard-codes its
 * host, so this reaches into its HTTP client; it is refused in production
 * builds so a stray variable can never divert live traffic.
 */
function pointAtTestGateway(instance: Razorpay) {
  const base = process.env.RAZORPAY_API_BASE_URL;
  if (!base) return;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('RAZORPAY_API_BASE_URL is for tests and is not allowed in production.');
  }
  const http = (instance as unknown as { api?: { rq?: { defaults?: { baseURL?: string } } } }).api
    ?.rq?.defaults;
  if (!http) {
    throw new Error('This razorpay SDK version cannot be pointed at a test gateway.');
  }
  http.baseURL = base;
}

export interface CreateOrderInput {
  /** Amount in rupees; converted to paise internally. */
  amountInRupees: number;
  /** Our own reference, echoed back on the webhook. Max 40 chars per Razorpay. */
  receipt: string;
  notes: Record<string, string>;
  currency?: string;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string | null;
  status: string;
}

export async function createOrder(input: CreateOrderInput): Promise<RazorpayOrder> {
  const order = await razorpayClient().orders.create({
    amount: rupeesToPaise(input.amountInRupees),
    currency: input.currency ?? 'INR',
    receipt: input.receipt.slice(0, 40),
    notes: input.notes,
    payment_capture: true,
  });

  return {
    id: String(order.id),
    amount: Number(order.amount),
    currency: String(order.currency),
    receipt: order.receipt ? String(order.receipt) : null,
    status: String(order.status),
  };
}

export interface RazorpayRefund {
  id: string;
  paymentId: string;
  /** Rupees. */
  amount: number;
  status: 'pending' | 'processed' | 'failed';
}

/** The gateway's own message for a rejected call, e.g. an over-refund. */
export class RazorpayApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null,
  ) {
    super(message);
    this.name = 'RazorpayApiError';
  }
}

export function normaliseRefundStatus(status: unknown): RazorpayRefund['status'] {
  return status === 'processed' || status === 'failed' ? status : 'pending';
}

/**
 * Refunds a captured payment in full, or in part when amountInRupees is given.
 * Notes are echoed back on the refund webhooks, which is how a refund whose
 * local record failed to save is still reconciled.
 */
export async function refundPayment(input: {
  razorpayPaymentId: string;
  amountInRupees: number;
  notes: Record<string, string>;
}): Promise<RazorpayRefund> {
  try {
    const refund = await razorpayClient().payments.refund(input.razorpayPaymentId, {
      amount: rupeesToPaise(input.amountInRupees),
      speed: 'normal',
      notes: input.notes,
    });
    return {
      id: String(refund.id),
      paymentId: String(refund.payment_id),
      amount: paiseToRupees(Number(refund.amount)),
      status: normaliseRefundStatus(refund.status),
    };
  } catch (error) {
    // The SDK rejects with { statusCode, error: { description } }.
    const failure = error as { statusCode?: number; error?: { description?: string } };
    if (failure && typeof failure === 'object' && ('statusCode' in failure || 'error' in failure)) {
      throw new RazorpayApiError(
        failure.error?.description ?? 'The payment gateway rejected the refund.',
        failure.statusCode ?? null,
      );
    }
    throw error;
  }
}

/**
 * Verifies the `x-razorpay-signature` header on a webhook delivery.
 *
 * The HMAC must be computed over the *raw* request body: re-serialising the
 * parsed JSON reorders keys and silently breaks verification. Comparison is
 * timing-safe.
 */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;

  const expected = crypto
    .createHmac('sha256', requireEnv('RAZORPAY_WEBHOOK_SECRET'))
    .update(rawBody, 'utf8')
    .digest('hex');

  const received = Buffer.from(signature, 'utf8');
  const computed = Buffer.from(expected, 'utf8');

  if (received.length !== computed.length) return false;
  return crypto.timingSafeEqual(received, computed);
}

/**
 * Verifies the signature Checkout hands back to the browser on success.
 * Used by the client-side confirmation step; the webhook remains the source
 * of truth for settlement.
 */
export function verifyCheckoutSignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const expected = crypto
    .createHmac('sha256', requireEnv('RAZORPAY_KEY_SECRET'))
    .update(`${params.orderId}|${params.paymentId}`, 'utf8')
    .digest('hex');

  const received = Buffer.from(params.signature, 'utf8');
  const computed = Buffer.from(expected, 'utf8');

  if (received.length !== computed.length) return false;
  return crypto.timingSafeEqual(received, computed);
}

/* ---------------------------------------------------------------------------
 * Webhook payload shapes (only the fields this codebase relies on).
 * ------------------------------------------------------------------------- */

export interface RazorpayPaymentEntity {
  id: string;
  entity: 'payment';
  amount: number;
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  order_id: string | null;
  invoice_id: string | null;
  method: string;
  amount_refunded: number;
  captured: boolean;
  description: string | null;
  email: string | null;
  contact: string | null;
  vpa?: string | null;
  bank?: string | null;
  wallet?: string | null;
  error_code: string | null;
  error_description: string | null;
  notes: Record<string, string>;
  created_at: number;
}

export interface RazorpayRefundEntity {
  id: string;
  entity: 'refund';
  amount: number;
  currency: string;
  payment_id: string;
  status: string;
  notes: Record<string, string> | unknown[];
  created_at: number;
}

export interface RazorpayWebhookPayload {
  entity: 'event';
  account_id: string;
  event: string;
  contains: string[];
  payload: {
    payment?: { entity: RazorpayPaymentEntity };
    refund?: { entity: RazorpayRefundEntity };
    order?: { entity: { id: string; amount: number; receipt: string | null; notes: Record<string, string> } };
  };
  created_at: number;
}

export function isPaymentEvent(payload: unknown): payload is RazorpayWebhookPayload {
  if (typeof payload !== 'object' || payload === null) return false;
  const candidate = payload as RazorpayWebhookPayload;
  return typeof candidate.event === 'string' && typeof candidate.payload === 'object';
}

/** Human label for the payment instrument, stored on fee_payments.payment_method. */
export function describeMethod(payment: RazorpayPaymentEntity): string {
  switch (payment.method) {
    case 'upi':
      return payment.vpa ? `UPI (${payment.vpa})` : 'UPI';
    case 'netbanking':
      return payment.bank ? `Netbanking (${payment.bank})` : 'Netbanking';
    case 'card':
      return 'Card';
    case 'wallet':
      return payment.wallet ? `Wallet (${payment.wallet})` : 'Wallet';
    case 'emi':
      return 'EMI';
    default:
      return payment.method ? payment.method.toUpperCase() : 'ONLINE';
  }
}
