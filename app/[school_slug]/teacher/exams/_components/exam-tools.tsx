'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, FileUp, Loader2, Save, Ticket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { StudentAvatar } from '@/components/student-avatar';
import { COMMON_SUBJECTS } from '@/lib/constants';
import { gradeFor } from '@/lib/grading';
import { uploadToBucket } from '@/lib/upload';
import { cn } from '@/lib/utils';
import {
  issueHallTickets,
  saveExamResults,
  saveSyllabus,
  setHallTicketsPublished,
} from '../../content-actions';
import { ClassFields } from '../../_components/class-fields';

/* ------------------------------------------------------------------ marks */

export interface MarksRow {
  studentId: string;
  fullName: string;
  rollNumber: string;
  photoUrl: string | null;
  marks: number | null;
  remarks: string | null;
}

interface MarksGridProps {
  schoolSlug: string;
  examName: string;
  subject: string;
  maxMarks: number;
  rows: MarksRow[];
}

/** Marks for one subject across a class. Grade and pass/fail update as you type. */
export function MarksGrid({ schoolSlug, examName, subject, maxMarks, rows }: MarksGridProps) {
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((row) => [row.studentId, row.marks === null ? '' : String(row.marks)])),
  );
  const [remarks, setRemarks] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((row) => [row.studentId, row.remarks ?? ''])),
  );
  const [pending, startTransition] = React.useTransition();
  const { toast } = useToast();

  function save() {
    const entries = rows.map((row) => {
      const raw = values[row.studentId]?.trim() ?? '';
      return {
        studentId: row.studentId,
        marks: raw === '' ? null : Number(raw),
        remarks: remarks[row.studentId]?.trim() || null,
      };
    });

    if (entries.some((entry) => entry.marks !== null && (Number.isNaN(entry.marks) || entry.marks < 0))) {
      toast({ variant: 'destructive', title: 'Marks must be numbers of 0 or more' });
      return;
    }

    startTransition(async () => {
      const result = await saveExamResults(schoolSlug, { examName, subject, maxMarks, entries });
      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Marks not saved', description: result.error });
        return;
      }
      toast({ variant: 'success', title: `Saved ${result.data.saved} results for ${subject}` });
    });
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border bg-background">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Student</th>
              <th className="w-28 px-3 py-2 font-medium">Marks / {maxMarks}</th>
              <th className="hidden w-20 px-3 py-2 text-center font-medium sm:table-cell">Grade</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const raw = values[row.studentId] ?? '';
              const marks = raw === '' ? null : Number(raw);
              const result = marks !== null && !Number.isNaN(marks) ? gradeFor(marks, maxMarks) : null;
              const over = marks !== null && marks > maxMarks;
              return (
                <tr key={row.studentId} className="border-t">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <StudentAvatar src={row.photoUrl} name={row.fullName} className="h-8 w-8 text-xs" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{row.fullName}</p>
                        <p className="text-xs text-muted-foreground">Roll {row.rollNumber}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      aria-label={`Marks for ${row.fullName}`}
                      inputMode="decimal"
                      value={raw}
                      onChange={(event) =>
                        setValues((current) => ({ ...current, [row.studentId]: event.target.value }))
                      }
                      className={cn('h-9', over && 'border-destructive')}
                    />
                  </td>
                  <td className="hidden px-3 py-2 text-center sm:table-cell">
                    {result && !over ? (
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-semibold',
                          result.passed ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800',
                        )}
                      >
                        {result.grade}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="hidden px-3 py-2 md:table-cell">
                    <Input
                      aria-label={`Remarks for ${row.fullName}`}
                      value={remarks[row.studentId] ?? ''}
                      maxLength={200}
                      onChange={(event) =>
                        setRemarks((current) => ({ ...current, [row.studentId]: event.target.value }))
                      }
                      className="h-9"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Button onClick={save} disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
        Save marks
      </Button>
      <p className="text-xs text-muted-foreground">
        Blank marks are skipped. Grades follow the CBSE nine-point scale; 33% is a pass.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------ hall tickets */

interface ClassProps {
  schoolSlug: string;
  schoolId: string;
  grades: string[];
  sectionsByGrade: Record<string, string[]>;
}

export function HallTicketIssueForm({ schoolSlug, grades, sectionsByGrade }: ClassProps) {
  const [pending, startTransition] = React.useTransition();
  const { toast } = useToast();
  const router = useRouter();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    startTransition(async () => {
      const result = await issueHallTickets(schoolSlug, {
        classGrade: String(data.get('classGrade') ?? ''),
        section: String(data.get('section') ?? '') || undefined,
        examName: String(data.get('examName') ?? ''),
        term: String(data.get('term') ?? ''),
        publish: data.get('publish') === 'on',
      });
      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Hall tickets not issued', description: result.error });
        return;
      }
      toast({ variant: 'success', title: `${result.data.issued} hall tickets issued` });
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
      <div className="grid grid-cols-2 gap-4">
        <ClassFields idPrefix="ticket" grades={grades} sectionsByGrade={sectionsByGrade} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="ticket-exam">Exam</Label>
          <Input id="ticket-exam" name="examName" placeholder="Half-Yearly Examination" required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ticket-term">Term</Label>
          <Input id="ticket-term" name="term" placeholder="Term 1, 2026-27" required />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="publish" className="h-4 w-4" />
        Publish to students and parents now
      </label>
      <Button type="submit" disabled={pending || grades.length === 0} className="justify-self-start">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Ticket className="h-4 w-4" aria-hidden />}
        Issue hall tickets
      </Button>
    </form>
  );
}

export function PublishToggle({
  schoolSlug,
  examName,
  term,
  published,
}: {
  schoolSlug: string;
  examName: string;
  term: string;
  published: boolean;
}) {
  const [pending, startTransition] = React.useTransition();
  const { toast } = useToast();
  const router = useRouter();

  return (
    <Button
      variant={published ? 'outline' : 'default'}
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await setHallTicketsPublished(schoolSlug, { examName, term, published: !published });
          if (!result.ok) {
            toast({ variant: 'destructive', title: 'Not updated', description: result.error });
            return;
          }
          toast({ title: published ? 'Hall tickets withdrawn' : 'Hall tickets published' });
          router.refresh();
        })
      }
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : published ? (
        <EyeOff className="h-4 w-4" aria-hidden />
      ) : (
        <Eye className="h-4 w-4" aria-hidden />
      )}
      {published ? 'Withdraw' : 'Publish'}
    </Button>
  );
}

/* ---------------------------------------------------------------- syllabus */

export function SyllabusForm({ schoolSlug, schoolId, grades }: ClassProps) {
  const [file, setFile] = React.useState<File | null>(null);
  const [pending, setPending] = React.useState(false);
  const { toast } = useToast();
  const router = useRouter();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (!file) {
      toast({ variant: 'destructive', title: 'Choose the syllabus PDF' });
      return;
    }

    setPending(true);
    try {
      const path = await uploadToBucket('academic-docs', schoolId, 'syllabus', file);
      const result = await saveSyllabus(schoolSlug, {
        classGrade: String(data.get('classGrade') ?? ''),
        subject: String(data.get('subject') ?? ''),
        path,
      });
      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Syllabus not published', description: result.error });
        return;
      }
      toast({ variant: 'success', title: 'Syllabus published' });
      form.reset();
      setFile(null);
      router.refresh();
    } catch (cause) {
      toast({
        variant: 'destructive',
        title: 'Upload failed',
        description: cause instanceof Error ? cause.message : 'Please try again.',
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="syllabus-class">Class</Label>
          <select
            id="syllabus-class"
            name="classGrade"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {grades.map((grade) => (
              <option key={grade} value={grade}>
                Class {grade}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="syllabus-subject">Subject</Label>
          <Input id="syllabus-subject" name="subject" list="syllabus-subjects" required />
          <datalist id="syllabus-subjects">
            {COMMON_SUBJECTS.map((subject) => (
              <option key={subject} value={subject} />
            ))}
          </datalist>
        </div>
      </div>
      <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
        <FileUp className="h-4 w-4" aria-hidden />
        {file ? file.name : 'Choose PDF (up to 10 MB)'}
        <input
          type="file"
          accept="application/pdf"
          className="sr-only"
          aria-label="Syllabus PDF"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>
      <Button type="submit" disabled={pending || grades.length === 0} className="justify-self-start">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileUp className="h-4 w-4" aria-hidden />}
        Publish syllabus
      </Button>
      <p className="text-xs text-muted-foreground">
        Publishing again for the same class and subject replaces the old copy.
      </p>
    </form>
  );
}
