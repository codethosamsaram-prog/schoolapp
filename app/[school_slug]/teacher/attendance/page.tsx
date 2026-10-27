import type { Metadata } from 'next';
import type { AttendanceStatus } from '@/types/database';
import { requireTenantSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { signedUrls } from '@/lib/storage';
import { academicYearOf, academicYearRange, recentAcademicYears } from '@/lib/academic';
import { todayInIST } from '@/lib/utils';
import { CLASS_GRADES } from '@/lib/constants';
import { Card, CardContent } from '@/components/ui/card';
import { AttendanceSheet, type RosterEntry } from './_components/attendance-sheet';
import { ClassPicker, type AttendanceView } from './_components/class-picker';
import { RollCall, type RollCallStudent } from './_components/roll-call';

export const metadata: Metadata = { title: 'Attendance' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { school_slug: string };
  searchParams: { year?: string; grade?: string; section?: string; date?: string; view?: string };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function gradeRank(grade: string): number {
  const index = (CLASS_GRADES as readonly string[]).indexOf(grade);
  return index === -1 ? CLASS_GRADES.length : index;
}

/** Roll numbers are text; order them 1, 2, 10 rather than 1, 10, 2. */
function compareRoll(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b, undefined, { numeric: true });
}

export default async function TeacherAttendancePage({ params, searchParams }: PageProps) {
  const { school } = await requireTenantSession(params.school_slug, [
    'SUPER_ADMIN',
    'SCHOOL_ADMIN',
    'TEACHER',
  ]);

  const supabase = createClient();
  const today = todayInIST();
  const view: AttendanceView = searchParams.view === 'list' ? 'list' : 'rollcall';

  // The year bounds the date: 1 April to 31 March, and never after today.
  const academicYears = recentAcademicYears(2);
  const year =
    searchParams.year && academicYears.includes(searchParams.year)
      ? searchParams.year
      : academicYearOf(today);
  const range = academicYearRange(year);
  const maxDate = range.end < today ? range.end : today;
  const requested = searchParams.date && DATE_PATTERN.test(searchParams.date) ? searchParams.date : null;
  const date =
    requested && requested >= range.start && requested <= maxDate ? requested : maxDate;

  const { data: classRows, error: classError } = await supabase
    .from('students')
    .select('class_grade, section')
    .eq('school_id', school.id)
    .eq('is_active', true);

  if (classError) {
    console.error('[attendance] class list failed', { error: classError.message });
  }

  const classes = new Map<string, Set<string>>();
  for (const row of classRows ?? []) {
    const sections = classes.get(row.class_grade) ?? new Set<string>();
    sections.add(row.section);
    classes.set(row.class_grade, sections);
  }

  const grades = [...classes.keys()].sort((a, b) => gradeRank(a) - gradeRank(b));
  const grade = searchParams.grade && classes.has(searchParams.grade) ? searchParams.grade : grades[0];
  const availableSections = grade ? [...(classes.get(grade) ?? new Set<string>())].sort() : [];
  const section =
    searchParams.section && availableSections.includes(searchParams.section)
      ? searchParams.section
      : availableSections[0];

  let students: {
    id: string;
    full_name: string;
    roll_number: string;
    usn: string | null;
    avatar_url: string | null;
    parent_phone: string;
  }[] = [];
  const existing = new Map<string, AttendanceStatus>();

  if (grade && section) {
    const [studentResult, markedResult] = await Promise.all([
      supabase
        .from('students')
        .select('id, full_name, roll_number, usn, avatar_url, parent_phone')
        .eq('school_id', school.id)
        .eq('class_grade', grade)
        .eq('section', section)
        .eq('is_active', true)
        .order('roll_number', { ascending: true, nullsFirst: false })
        .order('usn', { ascending: true }),
      supabase
        .from('attendance')
        .select('student_id, status')
        .eq('school_id', school.id)
        .eq('date', date),
    ]);

    if (studentResult.error) {
      console.error('[attendance] roster query failed', { error: studentResult.error.message });
    }
    if (markedResult.error) {
      console.error('[attendance] existing marks query failed', { error: markedResult.error.message });
    }

    students = [...(studentResult.data ?? [])].sort(
      (a, b) => compareRoll(a.roll_number, b.roll_number) || (a.usn ?? '').localeCompare(b.usn ?? ''),
    );
    for (const row of markedResult.data ?? []) existing.set(row.student_id, row.status);
  }

  const photos =
    view === 'rollcall'
      ? await signedUrls(supabase, 'avatars', students.map((student) => student.avatar_url))
      : new Map<string, string>();

  // Approved leave is already recorded; it is listed apart and not re-marked.
  const onLeave = students.filter((student) => existing.get(student.id) === 'EXCUSED_ABSENT');
  const toMark = students.filter((student) => existing.get(student.id) !== 'EXCUSED_ABSENT');

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight">Mark attendance</h1>
        <p className="text-sm text-muted-foreground">
          {view === 'rollcall'
            ? 'One student at a time, by roll number. Review the class at the end, then submit once.'
            : 'Tap a student to cycle through present, late and absent.'}{' '}
          Parents of absentees receive a WhatsApp alert when you submit.
        </p>
      </header>

      <ClassPicker
        schoolSlug={school.slug}
        academicYears={academicYears}
        selectedYear={year}
        grades={grades}
        sections={availableSections}
        selectedGrade={grade ?? null}
        selectedSection={section ?? null}
        selectedDate={date}
        minDate={range.start}
        maxDate={maxDate}
        view={view}
      />

      {onLeave.length > 0 ? (
        <Card aria-label="On approved leave" className="border-sky-200 bg-sky-50/60">
          <CardContent className="flex flex-wrap items-center gap-2 p-3 text-sm">
            <span className="font-medium text-sky-900">On approved leave:</span>
            {onLeave.map((student) => (
              <span key={student.id} className="rounded-full border border-sky-200 bg-white px-2 py-0.5 text-xs">
                {student.full_name} · Roll {student.roll_number}
              </span>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {!grade || !section ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No active students are enrolled yet. Ask the school office to add the class roster.
          </CardContent>
        </Card>
      ) : view === 'rollcall' ? (
        <RollCall
          // A new class or date starts a fresh roll call.
          key={`${grade}-${section}-${date}`}
          schoolSlug={school.slug}
          grade={grade}
          section={section}
          date={date}
          roster={toMark.map<RollCallStudent>((student) => ({
            id: student.id,
            fullName: student.full_name,
            rollNumber: student.roll_number,
            usn: student.usn,
            photoUrl: student.avatar_url ? photos.get(student.avatar_url) ?? null : null,
            initialStatus: existing.get(student.id) ?? null,
          }))}
        />
      ) : (
        <AttendanceSheet
          schoolSlug={school.slug}
          grade={grade}
          section={section}
          date={date}
          roster={toMark.map<RosterEntry>((student) => ({
            id: student.id,
            fullName: student.full_name,
            rollNumber: student.roll_number,
            parentPhone: student.parent_phone,
            initialStatus: existing.get(student.id) ?? null,
          }))}
        />
      )}
    </div>
  );
}
