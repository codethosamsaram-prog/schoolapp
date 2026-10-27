'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, WalletCards } from 'lucide-react';
import type { PayrollMethod } from '@/types/database';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { PAYROLL_METHOD_LABELS } from '@/lib/constants';
import { formatINR } from '@/lib/utils';

const selectClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface ProcessAllDialogProps {
  month: string;
  monthLabel: string;
  /** Active staff with no payslip for the month yet. */
  pending: { id: string; baseSalary: number }[];
}

/**
 * Pays everyone still unpaid for the month at base salary, in one batch.
 * Anyone needing additions or deductions is processed on their own row first.
 */
export function ProcessAllDialog({ month, monthLabel, pending }: ProcessAllDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [method, setMethod] = React.useState<PayrollMethod>('DIRECT_TRANSFER');
  const [reference, setReference] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const total = pending.reduce((sum, staff) => sum + staff.baseSalary, 0);

  async function submit() {
    if (method !== 'CASH' && !reference.trim()) {
      setError('Enter the batch reference for this transfer or cheque run.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const response = await fetch('/api/payroll/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month,
          entries: pending.map((staff) => ({
            staff_id: staff.id,
            payment_method: method,
            ...(method === 'CASH' ? {} : { payment_reference: reference.trim() }),
          })),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; summary?: string };
      if (!response.ok) {
        setError(body.error ?? body.summary ?? 'Payroll could not be processed.');
        return;
      }
      toast({ variant: 'success', title: `${monthLabel} payroll`, description: body.summary });
      setOpen(false);
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={pending.length === 0}>
          <WalletCards className="h-4 w-4" aria-hidden />
          Pay remaining ({pending.length})
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Pay remaining staff for {monthLabel}</DialogTitle>
          <DialogDescription>
            {pending.length} staff member{pending.length === 1 ? '' : 's'} will be paid their base
            salary, {formatINR(total, true)} in total, with no additions or deductions. Process anyone
            who needs adjustments from their own row first.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="grid min-w-0 content-start gap-2">
            <Label htmlFor="bulk-method">Paid by</Label>
            <select
              id="bulk-method"
              className={selectClass}
              value={method}
              onChange={(event) => setMethod(event.target.value as PayrollMethod)}
            >
              {Object.entries(PAYROLL_METHOD_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid min-w-0 content-start gap-2">
            <Label htmlFor="bulk-reference">Batch reference</Label>
            <Input
              id="bulk-reference"
              value={method === 'CASH' ? '' : reference}
              onChange={(event) => setReference(event.target.value)}
              disabled={method === 'CASH'}
              placeholder={method === 'CASH' ? 'Not needed' : ''}
              maxLength={60}
            />
          </div>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Pay {pending.length}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
