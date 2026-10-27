import type { Metadata } from 'next';
import Link from 'next/link';
import { IdCard, Search } from 'lucide-react';
import { requireTenantSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { signedUrls } from '@/lib/storage';
import { StudentAvatar } from '@/components/student-avatar';
import { CLASS_GRADES } from '@/lib/constants';
import { cn, formatINR } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AddStudentDialog } from './_components/add-student-dialog';
import { StudentActions } from './_components/student-actions';

export const metadata: Metadata = { title: 'Students' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { school_slug: string };
  searchParams: { grade?: string; q?: string; inactive?: string };
}

const selectClass =
  'h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Orders classes Nursery to XII rather than alphabetically. */
function gradeRank(grade: string): number {
  const index = (CLASS_GRADES as readonly string[]).indexOf(grade);
  return index === -1 ? CLASS_GRADES.length : index;
}

export default async function StudentsPage({ params, searchParams }: PageProps) {
  const { school } = await requireTenantSession(params.school_slug, [
    'SUPER_ADMIN',
    'SCHOOL_ADMIN',
  ]);

  const supabase = createClient();
  const grade = searchParams.grade?.trim() || null;
  const query = searchParams.q?.trim().slice(0, 60) || null;
  const showInactive = searchParams.inactive === '1';

  let request = supabase
    .from('students')
    .select(
      'id, full_name, roll_number, admission_number, class_grade, section, parent_name, parent_phone, parent_user_id, user_id, usn, date_of_birth, gender, blood_group, avatar_url, total_fee_due, current_balance, fee_concession, fee_concession_note, is_active',
    )
    .eq('school_id', school.id)
    .order('class_grade')
    .order('section')
    .order('roll_number')
    .limit(1000);

  if (!showInactive) request = request.eq('is_active', true);
  if (grade) request = request.eq('class_grade', grade);
  if (query) {
    // PostgREST's or() syntax reserves commas and parentheses.
    const term = query.replace(/[,()*%\\]/g, ' ');
    request = request.or(
      `full_name.ilike.%${term}%,admission_number.ilike.%${term}%,usn.ilike.%${term}%,parent_phone.ilike.%${term}%`,
    );
  }

  const { data, error } = await request;
  if (error) {
    console.error('[students] roster query failed', { error: error.message });
  }

  const students = [...(data ?? [])].sort(
    (a, b) =>
      gradeRank(a.class_grade) - gradeRank(b.class_grade) ||
      a.section.localeCompare(b.section) ||
      a.roll_number.localeCompare(b.roll_number, undefined, { numeric: true }),
  );

  const photos = await signedUrls(
    supabase,
    'avatars',
    students.map((student) => student.avatar_url),
  );

  const outstanding = students
    .filter((student) => student.is_active)
    .reduce((sum, student) => sum + Math.max(Number(student.current_balance), 0), 0);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 lg:px-8 lg:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">Students</h1>
          <p className="text-sm text-muted-foreground">
            {students.length} shown &middot; {formatINR(outstanding)} outstanding
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/${school.slug}/admin/students/id-cards${grade ? `?grade=${encodeURIComponent(grade)}&section=A` : ''}`}>
              <IdCard className="h-4 w-4" aria-hidden />
              ID cards
            </Link>
          </Button>
          <AddStudentDialog schoolSlug={school.slug} />
        </div>
      </header>

      <form method="get" className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            name="q"
            defaultValue={query ?? ''}
            placeholder="Name, USN, admission no. or phone"
            className="pl-9"
            aria-label="Search students"
          />
        </div>
        <select
          name="grade"
          defaultValue={grade ?? ''}
          className={selectClass}
          aria-label="Filter by class"
        >
          <option value="">All classes</option>
          {CLASS_GRADES.map((value) => (
            <option key={value} value={value}>
              Class {value}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            name="inactive"
            value="1"
            defaultChecked={showInactive}
            className="h-4 w-4"
          />
          Include withdrawn
        </label>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </form>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {students.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              {query || grade
                ? 'No students match these filters.'
                : 'No students enrolled yet. Add your first student to get started.'}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead className="hidden md:table-cell">Class</TableHead>
                  <TableHead className="hidden sm:table-cell">Parent</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((student) => {
                  const balance = Number(student.current_balance);
                  return (
                    <TableRow key={student.id} className={cn(!student.is_active && 'opacity-60')}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <StudentAvatar
                            src={student.avatar_url ? photos.get(student.avatar_url) : null}
                            name={student.full_name}
                            className="hidden h-9 w-9 text-xs sm:flex"
                          />
                          <div className="min-w-0">
                            <div className="font-medium">
                              {student.full_name}
                              {!student.is_active ? (
                                <Badge variant="outline" className="ml-2 text-[10px]">
                                  Withdrawn
                                </Badge>
                              ) : null}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Roll {student.roll_number}
                              {student.usn ? ` · ${student.usn}` : ''}
                              <span className="md:hidden">
                                {' '}
                                · {student.class_grade}-{student.section}
                              </span>
                              {student.user_id ? ' · student login' : ''}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant="outline">
                          {student.class_grade}-{student.section}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <div className="text-sm">{student.parent_name ?? '-'}</div>
                        <div className="text-xs text-muted-foreground">
                          {student.parent_phone}
                          {student.parent_user_id ? ' · portal login' : ''}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <div
                          className={cn(
                            'font-semibold',
                            balance > 0 ? 'text-amber-700' : 'text-emerald-700',
                          )}
                        >
                          {formatINR(balance)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          of {formatINR(student.total_fee_due)}
                        </div>
                        {Number(student.fee_concession) > 0 ? (
                          <div
                            className="text-xs text-emerald-700"
                            title={student.fee_concession_note ?? undefined}
                          >
                            {formatINR(student.fee_concession)} concession
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <StudentActions
                          schoolSlug={school.slug}
                          schoolId={school.id}
                          usn={student.usn}
                          hasStudentLogin={Boolean(student.user_id)}
                          avatarSrc={
                            student.avatar_url ? (photos.get(student.avatar_url) ?? null) : null
                          }
                          studentId={student.id}
                          studentName={student.full_name}
                          isActive={student.is_active}
                          hasParentLogin={Boolean(student.parent_user_id)}
                          balance={balance}
                          concession={Number(student.fee_concession)}
                          concessionNote={student.fee_concession_note}
                          details={{
                            fullName: student.full_name,
                            rollNumber: student.roll_number,
                            admissionNumber: student.admission_number,
                            classGrade: student.class_grade,
                            section: student.section,
                            parentName: student.parent_name,
                            parentPhone: student.parent_phone,
                            dateOfBirth: student.date_of_birth,
                            gender: student.gender,
                            bloodGroup: student.blood_group,
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
