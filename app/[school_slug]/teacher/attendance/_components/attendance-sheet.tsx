'use client';

import * as React from 'react';
import { CalendarOff, CheckCircle2, Clock, Loader2, Save, XCircle } from 'lucide-react';
import type { AttendanceStatus } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { submitBulkAttendance } from '../../actions';

export interface RosterEntry {
  id: string;
  fullName: string;
  rollNumber: string;
  parentPhone: string;
  initialStatus: AttendanceStatus | null;
}

interface AttendanceSheetProps {
  schoolSlug: string;
  grade: string;
  section: string;
  date: string;
  roster: RosterEntry[];
}

const CYCLE: AttendanceStatus[] = ['PRESENT', 'LATE', 'ABSENT'];

const STATUS_META: Record<
  AttendanceStatus,
  { label: string; icon: typeof CheckCircle2; row: string; chip: string }
> = {
  PRESENT: {
    label: 'Present',
    icon: CheckCircle2,
    row: 'border-emerald-200 bg-emerald-50',
    chip: 'bg-emerald-600 text-white',
  },
  LATE: {
    label: 'Late',
    icon: Clock,
    row: 'border-amber-200 bg-amber-50',
    chip: 'bg-amber-500 text-white',
  },
  ABSENT: {
    label: 'Absent',
    icon: XCircle,
    row: 'border-rose-200 bg-rose-50',
    chip: 'bg-rose-600 text-white',
  },
  // Never offered in CYCLE: students on approved leave are listed apart.
  EXCUSED_ABSENT: {
    label: 'On leave',
    icon: CalendarOff,
    row: 'border-sky-200 bg-sky-50',
    chip: 'bg-sky-600 text-white',
  },
};

export function AttendanceSheet({ schoolSlug, grade, section, date, roster }: AttendanceSheetProps) {
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();

  // Everyone starts present; that is how a register is actually taken.
  const buildInitial = React.useCallback(
    () =>
      Object.fromEntries(
        roster.map((student) => [student.id, student.initialStatus ?? 'PRESENT']),
      ) as Record<string, AttendanceStatus>,
    [roster],
  );

  const [marks, setMarks] = React.useState<Record<string, AttendanceStatus>>(buildInitial);

  // Roster changes when the teacher switches class, section or date.
  React.useEffect(() => {
    setMarks(buildInitial());
  }, [buildInitial]);

  const counts = React.useMemo(() => {
    const tally: Record<AttendanceStatus, number> = { PRESENT: 0, LATE: 0, ABSENT: 0, EXCUSED_ABSENT: 0 };
    for (const status of Object.values(marks)) tally[status] += 1;
    return tally;
  }, [marks]);

  const alreadyMarked = roster.some((student) => student.initialStatus !== null);

  function cycleStatus(studentId: string) {
    setMarks((current) => {
      const index = CYCLE.indexOf(current[studentId] ?? 'PRESENT');
      const next = CYCLE[(index + 1) % CYCLE.length];
      return { ...current, [studentId]: next };
    });
  }

  function setAll(status: AttendanceStatus) {
    setMarks(Object.fromEntries(roster.map((student) => [student.id, status])));
  }

  function handleSubmit() {
    const entries = roster.map((student) => ({
      studentId: student.id,
      status: marks[student.id] ?? ('PRESENT' as AttendanceStatus),
    }));

    startTransition(async () => {
      const result = await submitBulkAttendance(schoolSlug, { date, entries, notifyAbsentees: true });

      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Attendance not saved', description: result.error });
        return;
      }

      const { saved, absent, notificationsSent } = result.data;
      toast({
        variant: 'success',
        title: `Attendance saved for ${grade}-${section}`,
        description:
          absent > 0
            ? `${saved} students recorded. ${notificationsSent} of ${absent} absence alerts delivered.`
            : `${saved} students recorded. Full attendance today.`,
      });
    });
  }

  if (roster.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No students found in class {grade}-{section}.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3 pb-24">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {grade}-{section} &middot; {roster.length} students
        </span>
        {alreadyMarked ? (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
            Already marked today, editing
          </span>
        ) : null}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setAll('PRESENT')}>
            All present
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setAll('ABSENT')}>
            All absent
          </Button>
        </div>
      </div>

      <ul className="space-y-2">
        {roster.map((student) => {
          const status = marks[student.id] ?? 'PRESENT';
          const meta = STATUS_META[status];
          const Icon = meta.icon;

          return (
            <li key={student.id}>
              <button
                type="button"
                onClick={() => cycleStatus(student.id)}
                aria-label={`${student.fullName} is marked ${meta.label}. Tap to change.`}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors active:scale-[0.995]',
                  meta.row,
                )}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-background text-xs font-bold">
                  {student.rollNumber}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{student.fullName}</span>
                  <span className="block text-xs text-muted-foreground">
                    Parent: {student.parentPhone}
                  </span>
                </span>

                <span
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
                    meta.chip,
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  {meta.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Sticky action bar: the submit control stays reachable on a phone. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-1 text-xs">
            <span className="font-semibold text-emerald-700">{counts.PRESENT} present</span>
            <span className="font-semibold text-amber-700">{counts.LATE} late</span>
            <span className="font-semibold text-rose-700">{counts.ABSENT} absent</span>
          </div>

          <Button type="button" onClick={handleSubmit} disabled={pending} className="shrink-0">
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Saving
              </>
            ) : (
              <>
                <Save className="h-4 w-4" aria-hidden />
                Submit attendance
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
