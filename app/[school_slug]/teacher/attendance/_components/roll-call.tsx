'use client';

import * as React from 'react';
import { AnimatePresence, motion, useMotionValue, useTransform, type PanInfo } from 'framer-motion';
import { Check, CheckCircle2, ChevronLeft, ListChecks, Loader2, Send, UserX, X } from 'lucide-react';
import type { AttendanceStatus } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { StudentAvatar } from '@/components/student-avatar';
import { cn, formatDate } from '@/lib/utils';
import { submitBulkAttendance } from '../../actions';

export interface RollCallStudent {
  id: string;
  fullName: string;
  rollNumber: string;
  usn: string | null;
  photoUrl: string | null;
  initialStatus: AttendanceStatus | null;
}

interface RollCallProps {
  schoolSlug: string;
  grade: string;
  section: string;
  date: string;
  roster: RollCallStudent[];
}

type Marks = Record<string, AttendanceStatus>;

const SWIPE_THRESHOLD = 110;

/**
 * One-by-one roll call. Every decision lives in local state, so the next card
 * appears instantly with no network round trip. Nothing reaches the database
 * until "Submit Final Attendance", which writes the whole class in one
 * batched upsert and sends absence alerts.
 *
 * P marks present, A marks absent, Backspace or the left arrow go back one.
 * On a phone, swipe right for present and left for absent.
 */
export function RollCall({ schoolSlug, grade, section, date, roster }: RollCallProps) {
  const storageKey = `rollcall:${schoolSlug}:${grade}:${section}:${date}`;
  const { toast } = useToast();

  const initialMarks = React.useMemo<Marks>(() => {
    const marks: Marks = {};
    for (const student of roster) {
      if (student.initialStatus) marks[student.id] = student.initialStatus;
    }
    return marks;
  }, [roster]);

  const [marks, setMarks] = React.useState<Marks>(initialMarks);
  const [index, setIndex] = React.useState(() => {
    const first = roster.findIndex((student) => !student.initialStatus);
    return first === -1 ? roster.length : first;
  });
  const [direction, setDirection] = React.useState<1 | -1>(1);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [notify, setNotify] = React.useState(true);
  const [submitted, setSubmitted] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  // Survive an accidental reload mid-roll-call. Storage can be unavailable
  // (private mode, blocked site data), so every access is guarded.
  React.useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(storageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as { marks: Marks; index: number };
      const known = new Set(roster.map((student) => student.id));
      const restored = Object.fromEntries(
        Object.entries(parsed.marks).filter(([id]) => known.has(id)),
      ) as Marks;
      setMarks({ ...initialMarks, ...restored });
      setIndex(Math.min(Math.max(parsed.index, 0), roster.length));
    } catch {
      /* ignore */
    }
  }, [storageKey, roster, initialMarks]);

  React.useEffect(() => {
    try {
      if (submitted) window.sessionStorage.removeItem(storageKey);
      else window.sessionStorage.setItem(storageKey, JSON.stringify({ marks, index }));
    } catch {
      /* ignore */
    }
  }, [storageKey, marks, index, submitted]);

  const total = roster.length;
  const current = index < total ? roster[index] : null;
  const counts = React.useMemo(() => {
    const values = Object.values(marks);
    return {
      present: values.filter((status) => status === 'PRESENT').length,
      absent: values.filter((status) => status === 'ABSENT').length,
      late: values.filter((status) => status === 'LATE').length,
      unmarked: total - values.length,
    };
  }, [marks, total]);

  const mark = React.useCallback(
    (status: AttendanceStatus) => {
      if (!current || submitted) return;
      setDirection(status === 'ABSENT' ? -1 : 1);
      setMarks((previous) => ({ ...previous, [current.id]: status }));
      const next = index + 1;
      setIndex(next);
      if (next >= total) setReviewOpen(true);
    },
    [current, index, total, submitted],
  );

  const back = React.useCallback(() => {
    if (index === 0 || submitted) return;
    setDirection(-1);
    setIndex(index - 1);
  }, [index, submitted]);

  React.useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (reviewOpen || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;

      const key = event.key.toLowerCase();
      if (key === 'p') {
        event.preventDefault();
        mark('PRESENT');
      } else if (key === 'a') {
        event.preventDefault();
        mark('ABSENT');
      } else if (key === 'backspace' || key === 'arrowleft') {
        event.preventDefault();
        back();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mark, back, reviewOpen]);

  function toggle(studentId: string) {
    setMarks((previous) => ({
      ...previous,
      [studentId]: previous[studentId] === 'ABSENT' ? 'PRESENT' : 'ABSENT',
    }));
  }

  function submit() {
    const entries = roster
      .filter((student) => marks[student.id])
      .map((student) => ({ studentId: student.id, status: marks[student.id] }));

    startTransition(async () => {
      const result = await submitBulkAttendance(schoolSlug, {
        date,
        entries,
        notifyAbsentees: notify,
      });

      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Attendance not saved', description: result.error });
        return;
      }

      setSubmitted(true);
      setReviewOpen(false);
      toast({
        variant: 'success',
        title: `Attendance saved for Class ${grade}-${section}`,
        description:
          result.data.absent > 0
            ? `${result.data.absent} absent. ${result.data.notificationsSent} WhatsApp alert${result.data.notificationsSent === 1 ? '' : 's'} sent.`
            : 'Everyone is present.',
      });
    });
  }

  if (total === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No active students in Class {grade}-{section}.
        </CardContent>
      </Card>
    );
  }

  const position = Math.min(index + 1, total);
  const progress = (Object.keys(marks).length / total) * 100;
  const absentees = roster.filter((student) => marks[student.id] === 'ABSENT');

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium" aria-live="polite">
            {current ? `Student ${position} of ${total}` : `All ${total} students marked`}
          </span>
          <span className="text-muted-foreground">
            {counts.present + counts.late} present · {counts.absent} absent
          </span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Roll call progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={Object.keys(marks).length}
        >
          <motion.div
            className="h-full rounded-full bg-primary"
            initial={false}
            animate={{ width: `${progress}%` }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          />
        </div>
      </div>

      <div className="relative min-h-[380px] [perspective:1000px]">
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          {current ? (
            <SwipeCard
              key={current.id}
              student={current}
              direction={direction}
              existing={marks[current.id] ?? null}
              onSwipe={(status) => mark(status)}
            />
          ) : (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex min-h-[380px] flex-col items-center justify-center gap-4 rounded-2xl border bg-background p-6 text-center shadow-sm"
            >
              <CheckCircle2 className="h-12 w-12 text-emerald-600" aria-hidden />
              <div>
                <p className="text-lg font-semibold">
                  {submitted ? 'Attendance submitted' : 'Roll call complete'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {counts.present + counts.late} present, {counts.absent} absent on{' '}
                  {formatDate(date)}.
                </p>
              </div>
              <Button onClick={() => setReviewOpen(true)} variant={submitted ? 'outline' : 'default'}>
                <ListChecks className="h-4 w-4" aria-hidden />
                {submitted ? 'Review again' : 'Review and submit'}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="grid grid-cols-[auto_1fr_1fr] gap-3">
        <Button
          variant="outline"
          size="lg"
          className="h-16 px-4"
          onClick={back}
          disabled={index === 0 || submitted}
          aria-label="Previous student"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Button>
        <motion.div whileTap={{ scale: 0.96 }}>
          <Button
            size="lg"
            className="h-16 w-full bg-rose-600 text-base font-bold tracking-wide text-white hover:bg-rose-700"
            onClick={() => mark('ABSENT')}
            disabled={!current || submitted}
            aria-keyshortcuts="A"
          >
            <X className="h-5 w-5" aria-hidden />
            ABSENT
            <kbd className="ml-1 hidden rounded bg-white/20 px-1.5 text-xs font-medium sm:inline">A</kbd>
          </Button>
        </motion.div>
        <motion.div whileTap={{ scale: 0.96 }}>
          <Button
            size="lg"
            className="h-16 w-full bg-emerald-600 text-base font-bold tracking-wide text-white hover:bg-emerald-700"
            onClick={() => mark('PRESENT')}
            disabled={!current || submitted}
            aria-keyshortcuts="P"
          >
            <Check className="h-5 w-5" aria-hidden />
            PRESENT
            <kbd className="ml-1 hidden rounded bg-white/20 px-1.5 text-xs font-medium sm:inline">P</kbd>
          </Button>
        </motion.div>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Swipe right for present, left for absent. Nothing is saved until you submit.
        {current && Object.keys(marks).length > 0 ? (
          <>
            {' '}
            <button type="button" className="underline" onClick={() => setReviewOpen(true)}>
              Review now
            </button>
          </>
        ) : null}
      </p>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Review attendance</DialogTitle>
            <DialogDescription>
              Class {grade}-{section} · {formatDate(date, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/40">
              <p className="text-3xl font-bold text-emerald-700 dark:text-emerald-400">
                {counts.present + counts.late}
              </p>
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
                Present{counts.late ? ` (${counts.late} late)` : ''}
              </p>
            </div>
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-900 dark:bg-rose-950/40">
              <p className="text-3xl font-bold text-rose-700 dark:text-rose-400">{counts.absent}</p>
              <p className="text-xs font-medium uppercase tracking-wide text-rose-800 dark:text-rose-300">
                Absent
              </p>
            </div>
          </div>

          {counts.unmarked > 0 ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              {counts.unmarked} student{counts.unmarked === 1 ? ' is' : 's are'} not marked yet and
              will be left out.
            </p>
          ) : null}

          {absentees.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Absent students (tap to mark present)</p>
              <ul className="max-h-48 space-y-1 overflow-y-auto">
                {absentees.map((student) => (
                  <li key={student.id}>
                    <button
                      type="button"
                      onClick={() => toggle(student.id)}
                      disabled={submitted}
                      className="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
                    >
                      <StudentAvatar src={student.photoUrl} name={student.fullName} className="h-8 w-8 text-xs" />
                      <span className="min-w-0 flex-1 truncate">{student.fullName}</span>
                      <span className="text-xs text-muted-foreground">Roll {student.rollNumber}</span>
                      <UserX className="h-4 w-4 text-rose-600" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={notify}
              onChange={(event) => setNotify(event.target.checked)}
              disabled={submitted}
            />
            Send the WhatsApp absence alert to parents of absent students
          </label>

          <DialogFooter>
            <Button
              onClick={submit}
              disabled={pending || submitted || Object.keys(marks).length === 0}
              className="w-full sm:w-auto"
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Send className="h-4 w-4" aria-hidden />
              )}
              {submitted ? 'Submitted' : 'Submit Final Attendance'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface SwipeCardProps {
  student: RollCallStudent;
  direction: 1 | -1;
  existing: AttendanceStatus | null;
  onSwipe: (status: AttendanceStatus) => void;
}

const cardVariants = {
  enter: (direction: 1 | -1) => ({ x: direction * 60, opacity: 0, scale: 0.97 }),
  center: { x: 0, opacity: 1, scale: 1 },
  exit: (direction: 1 | -1) => ({ x: direction * 260, opacity: 0, rotate: direction * 8 }),
};

// AnimatePresence's popLayout mode measures the exiting card through a ref.
const SwipeCard = React.forwardRef<HTMLDivElement, SwipeCardProps>(function SwipeCard(
  { student, direction, existing, onSwipe },
  ref,
) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 0, 200], [-10, 0, 10]);
  const presentHint = useTransform(x, [0, SWIPE_THRESHOLD], [0, 1]);
  const absentHint = useTransform(x, [-SWIPE_THRESHOLD, 0], [1, 0]);

  function onDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.x > SWIPE_THRESHOLD || info.velocity.x > 600) onSwipe('PRESENT');
    else if (info.offset.x < -SWIPE_THRESHOLD || info.velocity.x < -600) onSwipe('ABSENT');
  }

  return (
    <motion.div
      ref={ref}
      custom={direction}
      variants={cardVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      onDragEnd={onDragEnd}
      style={{ x, rotate }}
      className="absolute inset-0 flex cursor-grab touch-pan-y select-none flex-col items-center justify-center gap-5 overflow-hidden rounded-2xl border bg-background p-6 text-center shadow-md active:cursor-grabbing"
      aria-label={`${student.fullName}, roll ${student.rollNumber}`}
    >
      <motion.span
        style={{ opacity: presentHint }}
        className="pointer-events-none absolute left-5 top-5 rotate-[-8deg] rounded-md border-2 border-emerald-600 px-2 py-0.5 text-sm font-extrabold tracking-widest text-emerald-600"
      >
        PRESENT
      </motion.span>
      <motion.span
        style={{ opacity: absentHint }}
        className="pointer-events-none absolute right-5 top-5 rotate-[8deg] rounded-md border-2 border-rose-600 px-2 py-0.5 text-sm font-extrabold tracking-widest text-rose-600"
      >
        ABSENT
      </motion.span>

      <StudentAvatar
        src={student.photoUrl}
        name={student.fullName}
        className="h-40 w-40 text-4xl ring-4 ring-background shadow-lg sm:h-44 sm:w-44"
      />

      <div className="space-y-1">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Roll {student.rollNumber}
          {student.usn ? <span className="font-normal normal-case tracking-normal"> · {student.usn}</span> : null}
        </p>
        <p className="text-2xl font-bold tracking-tight sm:text-3xl">{student.fullName}</p>
        {existing ? (
          <p
            className={cn(
              'text-xs font-medium',
              existing === 'ABSENT' ? 'text-rose-600' : 'text-emerald-600',
            )}
          >
            Currently marked {existing.toLowerCase()}
          </p>
        ) : null}
      </div>
    </motion.div>
  );
});
