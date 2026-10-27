'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, X } from 'lucide-react';
import type { PayLine, PayrollMethod } from '@/types/database';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { PAYROLL_METHOD_LABELS } from '@/lib/constants';
import { computePay } from '@/lib/payroll';
import { formatINR } from '@/lib/utils';

const selectClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface Line {
  key: number;
  label: string;
  amount: string;
}

interface ProcessSalaryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: string;
  monthLabel: string;
  staff: { id: string; fullName: string; employeeCode: string; baseSalary: number };
}

let nextKey = 0;
const blankLine = (label = ''): Line => ({ key: nextKey++, label, amount: '' });

function toPayLines(lines: Line[]): PayLine[] {
  return lines
    .filter((line) => line.label.trim() || line.amount)
    .map((line) => ({ label: line.label.trim(), amount: Number(line.amount) }));
}

export function ProcessSalaryDialog({
  open,
  onOpenChange,
  month,
  monthLabel,
  staff,
}: ProcessSalaryDialogProps) {
  const [additions, setAdditions] = React.useState<Line[]>([]);
  const [deductions, setDeductions] = React.useState<Line[]>([]);
  const [method, setMethod] = React.useState<PayrollMethod>('DIRECT_TRANSFER');
  const [reference, setReference] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const pay = computePay(
    staff.baseSalary,
    toPayLines(additions).filter((line) => line.amount > 0),
    toPayLines(deductions).filter((line) => line.amount > 0),
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const addLines = toPayLines(additions);
    const dedLines = toPayLines(deductions);
    const invalid = [...addLines, ...dedLines].find(
      (line) => !line.label || !Number.isFinite(line.amount) || line.amount <= 0,
    );
    if (invalid) {
      setError('Give every line a name and an amount above zero, or remove it.');
      return;
    }
    if (pay.netPay < 0) {
      setError('Deductions cannot exceed gross pay.');
      return;
    }
    if (method !== 'CASH' && !reference.trim()) {
      setError(method === 'CHEQUE' ? 'Enter the cheque number.' : 'Enter the UTR or transfer reference.');
      return;
    }

    setError(null);
    setPending(true);
    try {
      const response = await fetch('/api/payroll/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month,
          entries: [
            {
              staff_id: staff.id,
              additions: addLines,
              deductions: dedLines,
              payment_method: method,
              ...(method === 'CASH' ? {} : { payment_reference: reference.trim() }),
            },
          ],
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        processed?: { slip_number: string; net_pay: number }[];
        skipped?: { reason: string }[];
      };
      const slip = body.processed?.[0];
      if (!response.ok || !slip) {
        setError(body.skipped?.[0]?.reason ?? body.error ?? 'The salary could not be processed.');
        return;
      }
      toast({
        variant: 'success',
        title: `Payslip ${slip.slip_number} issued`,
        description: `${formatINR(slip.net_pay, true)} net pay to ${staff.fullName}.`,
      });
      onOpenChange(false);
      setAdditions([]);
      setDeductions([]);
      setReference('');
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Process salary: {monthLabel}</DialogTitle>
          <DialogDescription>
            {staff.fullName} ({staff.employeeCode}). Base salary {formatINR(staff.baseSalary, true)}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-5" noValidate>
          <LineEditor
            title="Additions"
            hint="Overtime, allowances, arrears"
            lines={additions}
            onChange={setAdditions}
          />
          <LineEditor
            title="Deductions"
            hint="Provident fund, professional tax, advances"
            lines={deductions}
            onChange={setDeductions}
            presets={[
              { label: 'Provident fund (12%)', amount: Math.round(staff.baseSalary * 0.12) },
              { label: 'Professional tax', amount: 200 },
            ]}
          />

          <dl className="grid grid-cols-3 gap-2 rounded-md border bg-muted/40 p-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Gross</dt>
              <dd className="font-semibold">{formatINR(pay.grossPay, true)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Deductions</dt>
              <dd className="font-semibold">{formatINR(pay.totalDeductions, true)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Net pay</dt>
              <dd className={pay.netPay < 0 ? 'font-bold text-destructive' : 'font-bold'} data-testid="net-pay">
                {formatINR(pay.netPay, true)}
              </dd>
            </div>
          </dl>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor={`method-${staff.id}`}>Paid by</Label>
              <select
                id={`method-${staff.id}`}
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
              <Label htmlFor={`reference-${staff.id}`}>
                {method === 'CHEQUE' ? 'Cheque number' : 'UTR / reference'}
              </Label>
              <Input
                id={`reference-${staff.id}`}
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
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Pay and issue payslip
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LineEditor({
  title,
  hint,
  lines,
  onChange,
  presets = [],
}: {
  title: string;
  hint: string;
  lines: Line[];
  onChange: (lines: Line[]) => void;
  presets?: PayLine[];
}) {
  const update = (key: number, patch: Partial<Line>) =>
    onChange(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const unused = presets.filter((preset) => !lines.some((line) => line.label === preset.label));

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">
        {title} <span className="font-normal text-muted-foreground">· {hint}</span>
      </legend>
      {lines.map((line, index) => (
        <div key={line.key} className="grid grid-cols-[1fr_110px_auto] gap-2">
          <Input
            aria-label={`${title} ${index + 1} name`}
            value={line.label}
            onChange={(event) => update(line.key, { label: event.target.value })}
            maxLength={60}
          />
          <Input
            aria-label={`${title} ${index + 1} amount`}
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={line.amount}
            onChange={(event) => update(line.key, { amount: event.target.value })}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-10 w-10 p-0"
            aria-label={`Remove ${title.toLowerCase()} ${index + 1}`}
            onClick={() => onChange(lines.filter((item) => item.key !== line.key))}
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...lines, blankLine()])}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add {title.toLowerCase().replace(/s$/, '')}
        </Button>
        {unused.map((preset) => (
          <Button
            key={preset.label}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              onChange([...lines, { ...blankLine(preset.label), amount: String(preset.amount) }])
            }
          >
            + {preset.label}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}
