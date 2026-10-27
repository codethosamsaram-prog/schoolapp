'use client';

import * as React from 'react';
import { Check, Loader2, X } from 'lucide-react';
import type { LeaveApplicant, LeaveStatus, LeaveType } from '@/types/database';
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
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { LEAVE_STATUS_META, LEAVE_TYPE_LABELS, leaveDays } from '@/lib/leave';
import { cn, formatDate, todayInIST } from '@/lib/utils';
import { applyForLeave, cancelLeave, reviewLeave } from './actions';

const selectClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export interface LeaveRowView {
  id: string;
  applicant: string;
  /** "Class IX-A" for students, the staff role for staff. */
  detail: string;
  kind: LeaveApplicant;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  reason: string;
  status: LeaveStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  canCancel: boolean;
  canReview: boolean;
}

function dateRange(start: string, end: string) {
  const days = leaveDays(start, end);
  return start === end
    ? `${formatDate(start)} · 1 day`
    : `${formatDate(start)} to ${formatDate(end)} · ${days} days`;
}

export function LeaveStatusBadge({ status }: { status: LeaveStatus }) {
  const meta = LEAVE_STATUS_META[status];
  return (
    <span className={cn('inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold', meta.tone)}>
      {meta.label}
    </span>
  );
}

/* ------------------------------------------------------------------ apply */

export function LeaveForm({
  schoolSlug,
  studentId,
  applicantLabel,
}: {
  schoolSlug: string;
  /** Set when applying for a student; absent for staff applying for themselves. */
  studentId?: string;
  applicantLabel: string;
}) {
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [start, setStart] = React.useState(todayInIST());
  const [pending, startTransition] = React.useTransition();
  const { toast } = useToast();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    if (studentId) formData.set('studentId', studentId);
    setErrors({});
    startTransition(async () => {
      const result = await applyForLeave(schoolSlug, formData);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast({ variant: 'destructive', title: 'Not submitted', description: result.error });
        return;
      }
      toast({ variant: 'success', title: 'Leave application submitted', description: 'You will see the decision here.' });
      form.reset();
      setStart(todayInIST());
    });
  }

  const error = (field: string) =>
    errors[field]?.[0] ? <p className="text-xs text-destructive">{errors[field][0]}</p> : null;

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate aria-label="Apply for leave">
      <p className="text-sm text-muted-foreground">
        For <span className="font-medium text-foreground">{applicantLabel}</span>
      </p>
      <div className="grid gap-2">
        <Label htmlFor="leaveType">Kind of leave</Label>
        <select id="leaveType" name="leaveType" className={selectClass} defaultValue="">
          <option value="" disabled>
            Choose
          </option>
          {Object.entries(LEAVE_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {error('leaveType')}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid min-w-0 content-start gap-2">
          <Label htmlFor="startDate">From</Label>
          <Input
            id="startDate"
            name="startDate"
            type="date"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
          {error('startDate')}
        </div>
        <div className="grid min-w-0 content-start gap-2">
          <Label htmlFor="endDate">To</Label>
          <Input id="endDate" name="endDate" type="date" min={start} defaultValue={todayInIST()} />
          {error('endDate')}
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="reason">Reason</Label>
        <Textarea id="reason" name="reason" maxLength={500} placeholder="Fever; doctor advised two days' rest." />
        {error('reason')}
      </div>
      <Button type="submit" disabled={pending} className="justify-self-start">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        Submit application
      </Button>
    </form>
  );
}

/* ---------------------------------------------------------------- listing */

function CancelButton({ schoolSlug, id }: { schoolSlug: string; id: string }) {
  const [pending, startTransition] = React.useTransition();
  const { toast } = useToast();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await cancelLeave(schoolSlug, id);
          toast(
            result.ok
              ? { title: 'Application withdrawn' }
              : { variant: 'destructive', title: 'Not withdrawn', description: result.error },
          );
        })
      }
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      Withdraw
    </Button>
  );
}

/**
 * Leave applications as a list. With `schoolSlug` set, rows the viewer may
 * cancel or review get those buttons.
 */
export function LeaveList({
  schoolSlug,
  rows,
  empty,
  showApplicant = false,
}: {
  schoolSlug: string;
  rows: LeaveRowView[];
  empty: string;
  showApplicant?: boolean;
}) {
  const [reviewing, setReviewing] = React.useState<LeaveRowView | null>(null);

  if (rows.length === 0) {
    return <p className="px-1 py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  }

  return (
    <>
      <ul className="divide-y rounded-lg border">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-start justify-between gap-3 p-4"
            aria-label={`${LEAVE_TYPE_LABELS[row.leaveType]} for ${row.applicant}`}
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                {showApplicant ? <span className="font-semibold">{row.applicant}</span> : null}
                {showApplicant ? <span className="text-xs text-muted-foreground">{row.detail}</span> : null}
                <span className="text-sm font-medium">{LEAVE_TYPE_LABELS[row.leaveType]}</span>
                <LeaveStatusBadge status={row.status} />
              </div>
              <p className="text-sm">{dateRange(row.startDate, row.endDate)}</p>
              <p className="break-words text-sm text-muted-foreground">{row.reason}</p>
              {row.reviewNote ? (
                <p className="text-sm">
                  <span className="text-muted-foreground">Note from school:</span> {row.reviewNote}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-1">
              {row.canCancel ? <CancelButton schoolSlug={schoolSlug} id={row.id} /> : null}
              {row.canReview && row.status === 'PENDING' ? (
                <Button size="sm" onClick={() => setReviewing(row)} aria-label={`Review leave for ${row.applicant}`}>
                  Review
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <ReviewDialog schoolSlug={schoolSlug} row={reviewing} onClose={() => setReviewing(null)} />
    </>
  );
}

/* ----------------------------------------------------------------- review */

function ReviewDialog({
  schoolSlug,
  row,
  onClose,
}: {
  schoolSlug: string;
  row: LeaveRowView | null;
  onClose: () => void;
}) {
  const [note, setNote] = React.useState('');
  const [pending, startTransition] = React.useTransition();
  const { toast } = useToast();

  function decide(decision: 'APPROVED' | 'REJECTED') {
    if (!row) return;
    const formData = new FormData();
    formData.set('leaveId', row.id);
    formData.set('decision', decision);
    if (note.trim()) formData.set('note', note.trim());

    startTransition(async () => {
      const result = await reviewLeave(schoolSlug, formData);
      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Not saved', description: result.error });
        return;
      }
      toast({
        variant: 'success',
        title: decision === 'APPROVED' ? 'Leave approved' : 'Leave rejected',
        description:
          decision === 'APPROVED' && row.kind === 'STUDENT'
            ? `${result.data.excusedDays} school day${result.data.excusedDays === 1 ? '' : 's'} marked as on leave in attendance.`
            : undefined,
      });
      setNote('');
      onClose();
    });
  }

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        {row ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {LEAVE_TYPE_LABELS[row.leaveType]} for {row.applicant}
              </DialogTitle>
              <DialogDescription>
                {row.detail} · {dateRange(row.startDate, row.endDate)}
              </DialogDescription>
            </DialogHeader>
            <p className="rounded-md border bg-muted/40 p-3 text-sm">{row.reason}</p>
            {row.kind === 'STUDENT' ? (
              <p className="text-xs text-muted-foreground">
                Approving marks each school day in this range as on leave in attendance, except days the
                student was marked present or late.
              </p>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor={`note-${row.id}`}>Note to the applicant (optional)</Label>
              <Input
                id={`note-${row.id}`}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={300}
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => decide('REJECTED')} disabled={pending}>
                <X className="h-4 w-4" aria-hidden />
                Reject
              </Button>
              <Button onClick={() => decide('APPROVED')} disabled={pending}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                Approve
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
