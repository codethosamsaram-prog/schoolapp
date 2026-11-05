'use client';

import * as React from 'react';
import { Check, Loader2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { reconcileBankStatement, reviewUpiClaim, setSchoolUpiVpa } from './actions';

export function UpiIdForm({ schoolSlug, current }: { schoolSlug: string; current: string }) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const { toast } = useToast();

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      action={(formData) =>
        startTransition(async () => {
          setError(null);
          const result = await setSchoolUpiVpa(schoolSlug, formData);
          if (!result.ok) return setError(result.error);
          toast({
            variant: 'success',
            title: result.data.vpa ? 'UPI ID saved' : 'UPI payments turned off',
          });
        })
      }
    >
      <div className="grid min-w-0 flex-1 gap-2">
        <Label htmlFor="school-vpa">UPI ID</Label>
        <Input id="school-vpa" name="vpa" defaultValue={current} placeholder="school@okaxis" autoComplete="off" />
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        Save
      </Button>
    </form>
  );
}

export function ClaimActions({ schoolSlug, claimId, utr }: { schoolSlug: string; claimId: string; utr: string }) {
  const [pending, startTransition] = React.useTransition();
  const [rejecting, setRejecting] = React.useState(false);
  const [note, setNote] = React.useState('');
  const { toast } = useToast();

  function run(approve: boolean) {
    startTransition(async () => {
      const result = await reviewUpiClaim(schoolSlug, { claimId, approve, note: approve ? undefined : note });
      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Not updated', description: result.error });
        return;
      }
      toast({
        variant: 'success',
        title: approve ? `UTR ${utr} approved` : `UTR ${utr} rejected`,
        description: approve ? 'Receipt issued and the family notified.' : 'The family has been told.',
      });
    });
  }

  if (rejecting) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={`Reason for rejecting UTR ${utr}`}
          placeholder="Reason (shown to the family)"
          value={note}
          maxLength={300}
          onChange={(event) => setNote(event.target.value)}
          className="h-9 w-56"
        />
        <Button size="sm" variant="destructive" disabled={pending} onClick={() => run(false)}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Confirm reject
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setRejecting(false)}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Button size="sm" disabled={pending} onClick={() => run(true)} aria-label={`Approve UTR ${utr}`}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
        Approve
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => setRejecting(true)}
        aria-label={`Reject UTR ${utr}`}
      >
        <X className="h-4 w-4" aria-hidden />
        Reject
      </Button>
    </div>
  );
}

const MAX_STATEMENT_BYTES = 1_500_000;

export function StatementReconciler({ schoolSlug, disabled }: { schoolSlug: string; disabled: boolean }) {
  const [text, setText] = React.useState('');
  const [pending, startTransition] = React.useTransition();
  const [summary, setSummary] = React.useState<string | null>(null);
  const { toast } = useToast();

  async function loadFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_STATEMENT_BYTES) {
      toast({ variant: 'destructive', title: 'File too large', description: 'Export a shorter date range.' });
      return;
    }
    setText(await file.text());
  }

  function reconcile() {
    const formData = new FormData();
    formData.set('statement', text);
    startTransition(async () => {
      const result = await reconcileBankStatement(schoolSlug, formData);
      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Not reconciled', description: result.error });
        return;
      }
      const { approved, amountMismatch, failed, notOnStatement } = result.data;
      setSummary(
        [
          `${approved.length} approved`,
          amountMismatch.length ? `${amountMismatch.length} with a different amount (${amountMismatch.join(', ')})` : null,
          failed.length ? `${failed.length} refused (${failed.map((item) => `${item.utr}: ${item.error}`).join('; ')})` : null,
          `${notOnStatement} not on this statement`,
        ]
          .filter(Boolean)
          .join(' · '),
      );
      if (approved.length > 0) setText('');
    });
  }

  return (
    <div className="grid gap-3">
      <Label htmlFor="statement-file" className="sr-only">
        Bank statement file
      </Label>
      <Input
        id="statement-file"
        type="file"
        accept=".csv,.txt,text/csv,text/plain"
        onChange={(event) => void loadFile(event.target.files?.[0])}
      />
      <Textarea
        aria-label="Bank statement rows"
        placeholder="…or paste statement rows here"
        rows={4}
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="font-mono text-xs"
      />
      <Button onClick={reconcile} disabled={pending || disabled || text.trim().length < 12} className="justify-self-start">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />}
        Match and approve
      </Button>
      {summary ? (
        <p role="status" className="text-sm">
          {summary}
        </p>
      ) : null}
    </div>
  );
}
