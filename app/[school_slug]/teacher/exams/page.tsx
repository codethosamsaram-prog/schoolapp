import type { Metadata } from 'next';
import Link from 'next/link';
import { FileText, ListChecks } from 'lucide-react';
import { requireTenantSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getSchoolClasses } from '@/lib/classes';
import { signedUrls } from '@/lib/storage';
import { COMMON_SUBJECTS } from '@/lib/constants';
import { cn, formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DeleteItemButton } from '@/components/delete-item-button';
import { deleteSyllabus } from '../content-actions';
import { ClassFields } from '../_components/class-fields';
import {
  HallTicketIssueForm,
  MarksGrid,
  PublishToggle,
  SyllabusForm,
  type MarksRow,
} from './_components/exam-tools';

export const metadata: Metadata = { title: 'Exams & syllabus' };
export const dynamic = 'force-dynamic';

type Tab = 'marks' | 'tickets' | 'syllabus';

interface PageProps {
  params: { school_slug: string };
  searchParams: {
    tab?: string;
    classGrade?: string;
    section?: string;
    exam?: string;
    subject?: string;
    max?: string;
  };
}

const TABS: { value: Tab; label: string }[] = [
  { value: 'marks', label: 'Enter marks' },
  { value: 'tickets', label: 'Hall tickets' },
  { value: 'syllabus', label: 'Syllabus' },
];

export default async function ExamsPage({ params, searchParams }: PageProps) {
  const { school } = await requireTenantSession(params.school_slug, [
    'SUPER_ADMIN',
    'SCHOOL_ADMIN',
    'TEACHER',
  ]);

  const tab: Tab = TABS.some((entry) => entry.value === searchParams.tab)
    ? (searchParams.tab as Tab)
    : 'marks';
  const supabase = createClient();
  const classes = await getSchoolClasses(supabase, school.id);
  const classProps = {
    schoolSlug: school.slug,
    schoolId: school.id,
    grades: classes.grades,
    sectionsByGrade: classes.sectionsByGrade,
  };

  return (
    <div className="space-y-5">
      <nav className="flex gap-1 rounded-lg bg-muted p-1 text-sm font-medium" aria-label="Exam tools">
        {TABS.map((entry) => (
          <Link
            key={entry.value}
            href={`/${school.slug}/teacher/exams?tab=${entry.value}`}
            aria-current={tab === entry.value ? 'page' : undefined}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-center transition-colors',
              tab === entry.value ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {entry.label}
          </Link>
        ))}
      </nav>

      {tab === 'marks' ? (
        <MarksTab schoolId={school.id} searchParams={searchParams} classProps={classProps} />
      ) : tab === 'tickets' ? (
        <HallTicketsTab schoolId={school.id} schoolSlug={school.slug} classProps={classProps} />
      ) : (
        <SyllabusTab schoolId={school.id} schoolSlug={school.slug} classProps={classProps} />
      )}
    </div>
  );
}

type ClassProps = {
  schoolSlug: string;
  schoolId: string;
  grades: string[];
  sectionsByGrade: Record<string, string[]>;
};

async function MarksTab({
  schoolId,
  searchParams,
  classProps,
}: {
  schoolId: string;
  searchParams: PageProps['searchParams'];
  classProps: ClassProps;
}) {
  const supabase = createClient();
  const grade = searchParams.classGrade && classProps.grades.includes(searchParams.classGrade)
    ? searchParams.classGrade
    : null;
  const section = searchParams.section || null;
  const exam = searchParams.exam?.trim().slice(0, 80) || null;
  const subject = searchParams.subject?.trim().slice(0, 60) || null;
  const max = Number(searchParams.max);
  const ready = Boolean(grade && exam && subject && Number.isFinite(max) && max > 0);

  let rows: MarksRow[] = [];
  if (ready && grade && exam && subject) {
    let query = supabase
      .from('students')
      .select('id, full_name, roll_number, avatar_url')
      .eq('school_id', schoolId)
      .eq('class_grade', grade)
      .eq('is_active', true);
    if (section) query = query.eq('section', section);
    const { data: students } = await query;
    const sorted = [...(students ?? [])].sort((a, b) =>
      a.roll_number.localeCompare(b.roll_number, undefined, { numeric: true }),
    );

    const [{ data: existing }, photos] = await Promise.all([
      supabase
        .from('exam_results')
        .select('student_id, marks_obtained, remarks')
        .eq('school_id', schoolId)
        .eq('exam_name', exam)
        .eq('subject', subject)
        .in('student_id', sorted.map((student) => student.id)),
      signedUrls(supabase, 'avatars', sorted.map((student) => student.avatar_url)),
    ]);
    const byStudent = new Map((existing ?? []).map((row) => [row.student_id, row]));

    rows = sorted.map((student) => ({
      studentId: student.id,
      fullName: student.full_name,
      rollNumber: student.roll_number,
      photoUrl: student.avatar_url ? photos.get(student.avatar_url) ?? null : null,
      marks: byStudent.has(student.id) ? Number(byStudent.get(student.id)?.marks_obtained) : null,
      remarks: byStudent.get(student.id)?.remarks ?? null,
    }));
  }

  const { data: examNames } = await supabase
    .from('exam_results')
    .select('exam_name')
    .eq('school_id', schoolId)
    .limit(500);
  const knownExams = [...new Set((examNames ?? []).map((row) => row.exam_name))];

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Choose the exam and subject</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="get" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <input type="hidden" name="tab" value="marks" />
            <ClassFields
              idPrefix="marks"
              grades={classProps.grades}
              sectionsByGrade={classProps.sectionsByGrade}
              defaultGrade={grade ?? undefined}
            />
            <div className="grid content-start gap-2">
              <Label htmlFor="marks-exam">Exam</Label>
              <Input id="marks-exam" name="exam" list="known-exams" defaultValue={exam ?? ''} placeholder="Periodic Test 1" required />
              <datalist id="known-exams">
                {knownExams.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            <div className="grid content-start gap-2">
              <Label htmlFor="marks-subject">Subject</Label>
              <Input id="marks-subject" name="subject" list="marks-subjects" defaultValue={subject ?? ''} required />
              <datalist id="marks-subjects">
                {COMMON_SUBJECTS.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            <div className="grid content-start gap-2">
              <Label htmlFor="marks-max">Maximum marks</Label>
              <Input id="marks-max" name="max" type="number" min={1} max={1000} defaultValue={ready ? max : 80} required />
            </div>
            <div className="flex items-end">
              <Button type="submit" variant="secondary" className="w-full">
                <ListChecks className="h-4 w-4" aria-hidden />
                Load class
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {ready && exam && subject ? (
        rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active students in that class.</p>
        ) : (
          <MarksGrid
            key={`${grade}-${section}-${exam}-${subject}-${max}`}
            schoolSlug={classProps.schoolSlug}
            examName={exam}
            subject={subject}
            maxMarks={max}
            rows={rows}
          />
        )
      ) : null}
    </div>
  );
}

async function HallTicketsTab({
  schoolId,
  schoolSlug,
  classProps,
}: {
  schoolId: string;
  schoolSlug: string;
  classProps: ClassProps;
}) {
  const { data } = await createClient()
    .from('hall_tickets')
    .select('id, exam_name, term, is_published, created_at')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false })
    .limit(2000);

  const groups = new Map<string, { examName: string; term: string; total: number; published: number; sampleId: string; createdAt: string }>();
  for (const row of data ?? []) {
    const key = `${row.exam_name}\u0000${row.term}`;
    const group = groups.get(key) ?? {
      examName: row.exam_name,
      term: row.term,
      total: 0,
      published: 0,
      sampleId: row.id,
      createdAt: row.created_at,
    };
    group.total += 1;
    if (row.is_published) group.published += 1;
    groups.set(key, group);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Issue hall tickets</CardTitle>
          <p className="text-sm text-muted-foreground">
            One ticket per active student, with their photo, USN and roll number. Issuing again
            for the same exam and term updates the existing tickets.
          </p>
        </CardHeader>
        <CardContent>
          <HallTicketIssueForm {...classProps} />
        </CardContent>
      </Card>

      <section className="space-y-3" aria-labelledby="issued-heading">
        <h2 id="issued-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Issued
        </h2>
        {groups.size === 0 ? (
          <p className="text-sm text-muted-foreground">No hall tickets issued yet.</p>
        ) : (
          [...groups.values()].map((group) => (
            <Card key={`${group.examName}-${group.term}`}>
              <CardContent className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{group.examName}</p>
                  <p className="text-xs text-muted-foreground">
                    {group.term} · {group.total} tickets · issued {formatDate(group.createdAt)}
                  </p>
                </div>
                <Badge variant={group.published === group.total ? 'secondary' : 'outline'}>
                  {group.published === group.total
                    ? 'Published'
                    : group.published === 0
                      ? 'Draft'
                      : `${group.published} of ${group.total} published`}
                </Badge>
                <Button asChild variant="ghost" size="sm">
                  <a href={`/hall-tickets/${group.sampleId}`} target="_blank" rel="noreferrer">
                    <FileText className="h-4 w-4" aria-hidden />
                    Sample
                  </a>
                </Button>
                <PublishToggle
                  schoolSlug={schoolSlug}
                  examName={group.examName}
                  term={group.term}
                  published={group.published === group.total}
                />
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}

async function SyllabusTab({
  schoolId,
  schoolSlug,
  classProps,
}: {
  schoolId: string;
  schoolSlug: string;
  classProps: ClassProps;
}) {
  const supabase = createClient();
  const { data } = await supabase
    .from('syllabus_copies')
    .select('*')
    .eq('school_id', schoolId)
    .order('class_grade')
    .order('subject');
  const links = await signedUrls(supabase, 'academic-docs', (data ?? []).map((row) => row.pdf_url));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Publish a syllabus</CardTitle>
        </CardHeader>
        <CardContent>
          <SyllabusForm {...classProps} />
        </CardContent>
      </Card>

      <section className="space-y-2" aria-labelledby="syllabus-heading">
        <h2 id="syllabus-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Published
        </h2>
        {(data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No syllabus copies yet.</p>
        ) : (
          (data ?? []).map((row) => (
            <Card key={row.id}>
              <CardContent className="flex items-center gap-3 p-3">
                <FileText className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    Class {row.class_grade} · {row.subject}
                  </p>
                  <p className="text-xs text-muted-foreground">{row.academic_year}</p>
                </div>
                {links.get(row.pdf_url) ? (
                  <Button asChild variant="ghost" size="sm">
                    <a href={links.get(row.pdf_url)} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  </Button>
                ) : null}
                <DeleteItemButton
                  action={deleteSyllabus.bind(null, schoolSlug, row.id)}
                  label={`Remove ${row.subject} syllabus for Class ${row.class_grade}`}
                  confirmText="Remove this syllabus copy?"
                />
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}
