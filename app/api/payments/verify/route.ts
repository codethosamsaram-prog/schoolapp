import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getCurrentProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { verifyCheckoutSignature } from '@/lib/razorpay';

/**
 * Confirms the signature Checkout returned to the browser, so the portal can
 * tell a parent their payment went through before the webhook lands.
 *
 * It deliberately writes nothing: fee_payments only becomes SUCCESS through
 * the signed webhook, which is the one source of truth for settlement.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  orderId: z.string().min(1).max(64),
  paymentId: z.string().min(1).max(64),
  signature: z.string().min(1).max(256),
});

export async function POST(request: NextRequest) {
  const current = await getCurrentProfile();
  if (!current) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // The order must be one the caller can already see under RLS.
  const supabase = createClient();
  const { data: payment } = await supabase
    .from('fee_payments')
    .select('id')
    .eq('razorpay_order_id', parsed.data.orderId)
    .maybeSingle();

  if (!payment) {
    return NextResponse.json({ error: 'Unknown order' }, { status: 404 });
  }

  let valid = false;
  try {
    valid = verifyCheckoutSignature(parsed.data);
  } catch (error) {
    console.error('[payments] checkout verification unavailable', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return NextResponse.json({ error: 'Verification unavailable' }, { status: 503 });
  }

  if (!valid) {
    return NextResponse.json({ error: 'Signature mismatch' }, { status: 400 });
  }

  return NextResponse.json({ verified: true, paymentId: payment.id });
}
