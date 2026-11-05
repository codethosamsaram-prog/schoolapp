'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { Loader2, Smartphone } from 'lucide-react';
import { buildUpiUri, isValidUtr, normaliseUtr } from '@/lib/upi';
import { formatINR } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';

interface UpiPayPanelProps {
  studentId: string;
  vpa: string;
  payeeName: string;
  invoiceRef: string;
  /** Balance less any claims still awaiting verification. */
  claimable: number;
}

/**
 * Step 1: scan the QR (or tap through to a UPI app on a phone) for the
 * chosen amount. Step 2: report the UTR the app shows once it has paid.
 */
export function UpiPayPanel({ studentId, vpa, payeeName, invoiceRef, claimable }: UpiPayPanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [amountText, setAmountText] = React.useState(claimable.toFixed(2));
  const [utr, setUtr] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const amount = Number(amountText);
  const amountValid = Number.isFinite(amount) && amount > 0 && amount <= claimable + 0.005;
  const uri = amountValid
    ? buildUpiUri({ vpa, payeeName, amount: Math.round(amount * 100) / 100, note: invoiceRef })
    : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!amountValid) return setError(`Enter an amount up to ${formatINR(claimable, true)}.`);
    if (!isValidUtr(utr)) return setError('The UTR is the 12-digit reference your UPI app shows after paying.');

    setPending(true);
    try {
      const response = await fetch('/api/payments/utr-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          amount: Math.round(amount * 100) / 100,
          utr: normaliseUtr(utr),
          invoiceRef,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? 'Could not submit. Please try again.');
        return;
      }
      setUtr('');
      toast({
        variant: 'success',
        title: 'Payment reported',
        description: 'The school will verify it with the bank and send your receipt.',
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[auto_1fr]">
      <div className="flex flex-col items-center gap-3">
        <div className="rounded-xl border bg-white p-3" data-testid="upi-qr" data-upi-uri={uri ?? ''}>
          {uri ? (
            <QRCodeSVG
              value={uri}
              size={208}
              level="M"
              marginSize={0}
              title={`Pay ${formatINR(amount, true)} to ${vpa}`}
            />
          ) : (
            <div className="flex h-[208px] w-[208px] items-center justify-center text-center text-xs text-muted-foreground">
              Enter a valid amount to show the QR
            </div>
          )}
        </div>
        <p className="font-mono text-sm">{vpa}</p>
        {uri ? (
          <a
            href={uri}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent md:hidden"
          >
            <Smartphone className="h-4 w-4" aria-hidden />
            Open in a UPI app
          </a>
        ) : null}
      </div>

      <form onSubmit={submit} className="grid min-w-0 content-start gap-4" noValidate>
        <div className="grid gap-2">
          <Label htmlFor="upi-amount">1. Amount to pay</Label>
          <Input
            id="upi-amount"
            name="amount"
            inputMode="decimal"
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
            aria-describedby="upi-amount-hint"
          />
          <p id="upi-amount-hint" className="text-xs text-muted-foreground">
            Up to {formatINR(claimable, true)}. Scan the QR with any UPI app (Google Pay, PhonePe, Paytm,
            BHIM) and pay. The note <span className="font-mono">{invoiceRef}</span> tells the school who paid.
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="upi-utr">2. UPI reference (UTR) from your app</Label>
          <Input
            id="upi-utr"
            name="utr"
            inputMode="numeric"
            autoComplete="off"
            placeholder="12-digit number"
            value={utr}
            onChange={(event) => setUtr(event.target.value)}
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={pending} className="justify-self-start">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Report payment
        </Button>
      </form>
    </div>
  );
}
