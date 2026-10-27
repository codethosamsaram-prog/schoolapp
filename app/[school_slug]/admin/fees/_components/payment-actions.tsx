'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Ban, FileText, Loader2, MoreHorizontal, Undo2 } from 'lucide-react';
import type { PaymentStatus } from '@/types/database';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { isSettledPayment } from '@/lib/constants';
import { formatINR } from '@/lib/utils';
import { voidOfflinePayment } from '../../actions';

interface PaymentActionsProps {
  schoolSlug: string;
  paymentId: string;
  status: PaymentStatus;
  online: boolean;
  amountPaid: number;
  amountRefunded: number;
  studentName: string;
  receiptNumber: string | null;
}

type Panel = 'void' | 'refund' | null;

export function PaymentActions(props: PaymentActionsProps) {
  const { paymentId, status, online, studentName, receiptNumber } = props;
  const [panel, setPanel] = React.useState<Panel>(null);

  const canVoid = status === 'SUCCESS' && !online;
  const canRefund = online && (status === 'SUCCESS' || status === 'PARTIALLY_REFUNDED');
  const hasReceipt = isSettledPayment(status) || status === 'VOIDED';

  if (!canVoid && !canRefund && !hasReceipt) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label={`Actions for ${studentName}'s payment${receiptNumber ? ` ${receiptNumber}` : ''}`}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {hasReceipt ? (
            <DropdownMenuItem asChild>
              <a href={`/receipts/${paymentId}`} target="_blank" rel="noreferrer">
                <FileText className="mr-2 h-4 w-4" aria-hidden />
                Open receipt
              </a>
            </DropdownMenuItem>
          ) : null}
          {canVoid ? (
            <DropdownMenuItem onSelect={() => setPanel('void')}>
              <Ban className="mr-2 h-4 w-4" aria-hidden />
              Void receipt
            </DropdownMenuItem>
          ) : null}
          {canRefund ? (
            <DropdownMenuItem onSelect={() => setPanel('refund')}>
              <Undo2 className="mr-2 h-4 w-4" aria-hidden />
              Initiate refund
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={panel !== null} onOpenChange={(open) => !open && setPanel(null)}>
        <DialogContent className="sm:max-w-[440px]">
          {panel === 'void' ? (
            <VoidPanel {...props} onDone={() => setPanel(null)} />
          ) : panel === 'refund' ? (
            <RefundPanel {...props} onDone={() => setPanel(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

type PanelProps = PaymentActionsProps & { onDone: () => void };

function summary({ amountPaid, studentName, receiptNumber }: PaymentActionsProps): string {
  return `${formatINR(amountPaid, true)} from ${studentName}${receiptNumber ? `, receipt ${receiptNumber}` : ''}`;
}

function VoidPanel(props: PanelProps) {
  const { schoolSlug, paymentId, onDone } = props;
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const { toast } = useToast();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set('paymentId', paymentId);
    setError(null);

    startTransition(async () => {
      const result = await voidOfflinePayment(schoolSlug, formData);
      if (!result.ok) {
        setError(result.fieldErrors?.reason?.[0] ?? result.error);
        return;
      }
      toast({
        title: `Receipt ${result.data.receiptNumber ?? ''} voided`.replace(/\s+/g, ' '),
        description: 'The amount is back on the student’s outstanding balance.',
      });
      onDone();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Void this receipt?</DialogTitle>
        <DialogDescription>
          {summary(props)}. The receipt stays in the ledger marked VOIDED and the amount goes back
          on the balance. This cannot be undone; record the payment again if it was correct.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
        <div className="grid gap-2">
          <Label htmlFor={`void-reason-${paymentId}`}>Reason</Label>
          <Input
            id={`void-reason-${paymentId}`}
            name="reason"
            placeholder="Cheque bounced, entered twice..."
            maxLength={200}
            required
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Void receipt
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function RefundPanel(props: PanelProps) {
  const { paymentId, amountPaid, amountRefunded, onDone } = props;
  const refundable = Math.round((amountPaid - amountRefunded) * 100) / 100;
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = Number(form.get('amount'));
    const reason = String(form.get('reason') ?? '').trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter the amount to refund.');
      return;
    }
    if (amount > refundable) {
      setError(`At most ${formatINR(refundable, true)} can be refunded.`);
      return;
    }
    if (reason.length < 3) {
      setError('Give a reason for the refund.');
      return;
    }

    setError(null);
    setPending(true);
    try {
      const response = await fetch('/api/payments/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_id: paymentId, reason, amount }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        amount?: number;
        status?: string;
      };
      if (!response.ok) {
        setError(body.error ?? 'The refund could not be issued.');
        return;
      }
      toast({
        variant: 'success',
        title: `${formatINR(body.amount ?? amount, true)} refund issued`,
        description:
          body.status === 'processed'
            ? 'Razorpay has processed it. The amount is back on the balance.'
            : 'Razorpay is processing it; banks usually take 5 to 7 working days.',
      });
      onDone();
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Refund through Razorpay</DialogTitle>
        <DialogDescription>
          {summary(props)}.
          {amountRefunded > 0 ? ` ${formatINR(amountRefunded, true)} is already refunded.` : ''}{' '}
          The money goes back to the payer&apos;s original account and the amount is added back to
          the student&apos;s balance.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
        <div className="grid gap-2">
          <Label htmlFor={`refund-amount-${paymentId}`}>Amount (₹)</Label>
          <Input
            id={`refund-amount-${paymentId}`}
            name="amount"
            type="number"
            min={1}
            max={refundable}
            step="0.01"
            inputMode="decimal"
            defaultValue={refundable}
            required
          />
          <p className="text-xs text-muted-foreground">
            Up to {formatINR(refundable, true)}. Lower it for a partial refund.
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`refund-reason-${paymentId}`}>Reason</Label>
          <Input
            id={`refund-reason-${paymentId}`}
            name="reason"
            placeholder="Paid twice, student withdrawn..."
            maxLength={200}
            required
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Issue refund
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
