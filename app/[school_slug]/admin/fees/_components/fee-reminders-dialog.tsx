'use client';

import * as React from 'react';
import { BellRing, Loader2 } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { formatINR } from '@/lib/utils';
import { sendFeeReminders } from '../../actions';

const selectClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export interface OwingClass {
  classGrade: string;
  students: number;
  /** Families that would be messaged now, outside the cooldown. */
  due: number;
  amount: number;
}

interface FeeRemindersDialogProps {
  schoolSlug: string;
  classes: OwingClass[];
  cooldownDays: number;
  /**
   * False when the WhatsApp health check says reminders would not deliver.
   * Reminders still go out in-app; only families without a portal login miss out.
   */
  whatsappReady: boolean;
}

export function FeeRemindersDialog({
  schoolSlug,
  classes,
  cooldownDays,
  whatsappReady,
}: FeeRemindersDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [classGrade, setClassGrade] = React.useState('');
  const [pending, startTransition] = React.useTransition();
  const { toast } = useToast();

  const scope = classGrade ? classes.filter((row) => row.classGrade === classGrade) : classes;
  const students = scope.reduce((sum, row) => sum + row.students, 0);
  const due = scope.reduce((sum, row) => sum + row.due, 0);
  const amount = scope.reduce((sum, row) => sum + row.amount, 0);

  function handleSend() {
    const formData = new FormData();
    if (classGrade) formData.set('classGrade', classGrade);

    startTransition(async () => {
      const result = await sendFeeReminders(schoolSlug, formData);
      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Reminders not sent', description: result.error });
        return;
      }
      const { sent, failed, recentlyReminded, inApp, whatsapp } = result.data;
      toast({
        variant: failed > 0 ? 'destructive' : 'success',
        title: `${sent} reminder${sent === 1 ? '' : 's'} sent`,
        description: [
          sent > 0 ? `${inApp} in the portal, ${whatsapp} by WhatsApp.` : null,
          failed > 0
            ? `${failed} could not be delivered: no portal login, and WhatsApp failed or is not set up.`
            : null,
          recentlyReminded > 0
            ? `${recentlyReminded} skipped, reminded in the last ${cooldownDays} days.`
            : null,
        ]
          .filter(Boolean)
          .join(' ') || undefined,
      });
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={classes.length === 0}>
          <BellRing className="h-4 w-4" aria-hidden />
          Send fee reminders
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Remind families with dues</DialogTitle>
          <DialogDescription>
            Families with a portal login get an in-app notification with the outstanding amount;
            the rest get a WhatsApp message. A family is reminded at most once every {cooldownDays}{' '}
            days.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="reminder-class">Send to</Label>
            <select
              id="reminder-class"
              className={selectClass}
              value={classGrade}
              onChange={(event) => setClassGrade(event.target.value)}
            >
              <option value="">Every class</option>
              {classes.map((row) => (
                <option key={row.classGrade} value={row.classGrade}>
                  Class {row.classGrade} ({row.students} owing)
                </option>
              ))}
            </select>
          </div>

          <p className="rounded-md border bg-muted/40 p-3 text-sm">
            {students} student{students === 1 ? '' : 's'} owe {formatINR(amount)}.{' '}
            {due === students
              ? 'All of them will be messaged.'
              : `${due} will be messaged; ${students - due} were reminded recently.`}
          </p>

          {!whatsappReady ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              WhatsApp is not ready, so only families with a portal login will be reminded. The
              notice on this page explains what to fix.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={pending || due === 0}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Send {due} reminder{due === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
