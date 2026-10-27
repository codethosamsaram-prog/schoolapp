'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { IndianRupee, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { formatINR } from '@/lib/utils';

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', handler: (response: { error?: { description?: string } }) => void): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

let checkoutLoader: Promise<void> | null = null;

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  checkoutLoader ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      checkoutLoader = null;
      reject(new Error('Could not load Razorpay Checkout'));
    };
    document.body.appendChild(script);
  });
  return checkoutLoader;
}

interface PayButtonProps {
  studentId: string;
  studentName: string;
  amount: number;
  schoolName: string;
  prefill: { name: string; email: string | null; contact: string | null };
}

/**
 * Opens Razorpay Checkout for a student's outstanding balance.
 *
 * The server decides the amount (create-order reads it from the database) and
 * the webhook settles the payment. The browser's success callback is only used
 * to tell the parent that their payment went through and to refresh once the
 * webhook has had a moment to land.
 */
export function PayButton({ studentId, studentName, amount, schoolName, prefill }: PayButtonProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);

  async function handlePay() {
    setPending(true);

    try {
      const [response] = await Promise.all([
        fetch('/api/payments/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId }),
        }),
        loadCheckout(),
      ]);

      const order = (await response.json().catch(() => null)) as
        | { orderId: string; amount: number; currency: string; keyId: string; error?: string }
        | null;

      if (!response.ok || !order?.orderId) {
        throw new Error(order?.error ?? 'Could not start the payment');
      }
      if (!order.keyId || !window.Razorpay) {
        throw new Error('Online payments are not configured for this school yet');
      }

      const checkout = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: schoolName,
        description: `Fees for ${studentName}`,
        prefill: {
          name: prefill.name || undefined,
          email: prefill.email ?? undefined,
          contact: prefill.contact ?? undefined,
        },
        modal: { ondismiss: () => setPending(false) },
        handler: async (success: RazorpaySuccess) => {
          const verified = await fetch('/api/payments/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderId: success.razorpay_order_id,
              paymentId: success.razorpay_payment_id,
              signature: success.razorpay_signature,
            }),
          }).then((res) => res.ok, () => false);

          toast({
            variant: verified ? 'success' : 'default',
            title: verified ? 'Payment received' : 'Payment submitted',
            description:
              'Your receipt will appear here and on WhatsApp as soon as the bank confirms it.',
          });
          setPending(false);

          // Settlement happens on the webhook; give it a moment, then refresh.
          window.setTimeout(() => router.refresh(), 4000);
        },
      });

      checkout.on('payment.failed', (failure) => {
        toast({
          variant: 'destructive',
          title: 'Payment failed',
          description: failure.error?.description ?? 'No money was deducted. Please try again.',
        });
      });

      checkout.open();
    } catch (error) {
      setPending(false);
      toast({
        variant: 'destructive',
        title: 'Could not start the payment',
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    }
  }

  return (
    <Button onClick={handlePay} disabled={pending} size="lg">
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <IndianRupee className="h-4 w-4" aria-hidden />
      )}
      Pay {formatINR(amount)}
    </Button>
  );
}
