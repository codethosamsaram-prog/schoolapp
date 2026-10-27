import type { Metadata } from 'next';
import type { AttendanceStatus } from '@/types/database';
import { getPortalContext } from '@/lib/portal';
import { createClient } from '@/lib/supabase/server';
import { academicYearOf, academicYearRange } from '@/lib/academic';
import { ATTENDANCE_STATUS_LABELS } from '@/lib/constants';
import { cn, formatDate, percent, todayInIST } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StudentAvatar } from '@/components/student-avatar';
import { FadeIn } from '@/components/motion';

export const metadata: Metadata = { title: 'My details' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { school_slug: string };
}

const DOT: Record<AttendanceStatus, string> = {
  PRESENT: 'bg-emerald-500',
  LATE: 'bg-amber-500',
  ABSENT: 'bg-rose-500',
  EXCUSED_ABSENT: 'bg-sky-400',
};

export default async function PortalProfilePage({ params }: PageProps) {
  const { active, profile } = await getPortalContext(params.school_slug);
  if (!active) return null;

  const today = todayInIST();
  const year = academicYearOf(today);
  const { start } = academicYearRange(year);

  const { data } = await createClient()
    .from('attendance')
    .select('date, status')
    .eq('student_id', active.id)
    .gte('date', start)
    .order('date', { ascending: false });

  const rows = data ?? [];
  const count = (status: AttendanceStatus) => rows.filter((row) => row.status === status).length;
  const present = count('PRESENT');
  const late = count('LATE');
  const absent = count('ABSENT');
  const onLeave = count('EXCUSED_ABSENT');
  const recent = rows.slice(0, 30).reverse();

  // Month-by-month attendance for the year so far.
  const months = new Map<string, { attended: number; total: number }>();
  for (const row of rows) {
    const key = row.date.slice(0, 7);
    const entry = months.get(key) ?? { attended: 0, total: 0 };
    entry.total += 1;
    if (row.status === 'PRESENT' || row.status === 'LATE') entry.attended += 1;
    months.set(key, entry);
  }
  const monthly = [...months.entries()].sort(([a], [b]) => a.localeCompare(b));

  const details: [string, string][] = [
    ['USN', active.usn ?? 'Not assigned'],
    ['Roll number', active.rollNumber],
    ['Class', `${active.classGrade} - ${active.section}`],
    ['Admission no.', active.admissionNumber ?? '-'],
    ['Date of birth', active.dateOfBirth ? formatDate(active.dateOfBirth) : '-'],
    ['Gender', active.gender ? active.gender.charAt(0) + active.gender.slice(1).toLowerCase() : '-'],
  ];
  const guardian: [string, string][] = [
    ['Parent / guardian', active.parentName ?? '-'],
    ['Mobile (WhatsApp alerts)', active.parentPhone],
    ...(profile.role === 'PARENT' ? ([['Portal login', profile.email ?? '-']] as [string, string][]) : []),
  ];

  return (
    <div className="space-y-6">
      <FadeIn>
        <Card>
          <CardContent className="flex flex-col items-center gap-5 p-6 text-center sm:flex-row sm:text-left">
            <StudentAvatar src={active.photoUrl} name={active.fullName} className="h-24 w-24 text-2xl" />
            <div className="min-w-0 space-y-1">
              <h1 className="text-2xl font-bold tracking-tight">{active.fullName}</h1>
              <p className="text-sm text-muted-foreground">
                {active.usn ? `USN ${active.usn} · ` : ''}Class {active.classGrade}-{active.section} · Roll{' '}
                {active.rollNumber}
              </p>
            </div>
          </CardContent>
        </Card>
      </FadeIn>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Student details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y text-sm">
              {details.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 py-2">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Guardian details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y text-sm">
              {guardian.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 py-2">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="break-all text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              To change these details, contact the school office.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Attendance, {year}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {rows.length ? `${percent(present + late, rows.length)} attended` : 'Nothing marked yet'}
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
            {(
              [
                ['Present', present, 'text-emerald-700'],
                ['Late', late, 'text-amber-700'],
                ['Absent', absent, 'text-rose-700'],
                ['On leave', onLeave, 'text-sky-700'],
              ] as const
            ).map(([label, value, tone]) => (
              <div key={label} className="rounded-lg border p-3">
                <p className={cn('text-2xl font-bold', tone)}>{value}</p>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>

          {monthly.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">By month</p>
              {monthly.map(([month, entry]) => {
                const value = (entry.attended / entry.total) * 100;
                return (
                  <div key={month} className="flex items-center gap-3 text-sm">
                    <span className="w-16 shrink-0 text-muted-foreground">
                      {formatDate(`${month}-01`, { month: 'short', year: '2-digit' })}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn('h-full rounded-full', value >= 75 ? 'bg-emerald-500' : 'bg-amber-500')}
                        style={{ width: `${value}%` }}
                      />
                    </div>
                    <span className="w-24 shrink-0 text-right tabular-nums text-muted-foreground">
                      {entry.attended}/{entry.total} days
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}

          {recent.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Last {recent.length} school days</p>
              <ul className="flex flex-wrap gap-1.5" aria-label="Recent attendance">
                {recent.map((row) => (
                  <li
                    key={row.date}
                    className={cn('h-5 w-5 rounded', DOT[row.status])}
                    title={`${formatDate(row.date)}: ${ATTENDANCE_STATUS_LABELS[row.status]}`}
                  >
                    <span className="sr-only">
                      {formatDate(row.date)}: {ATTENDANCE_STATUS_LABELS[row.status]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
