import type { Metadata } from 'next';
import { Award, Download, Ticket } from 'lucide-react';
import { getPortalContext } from '@/lib/portal';
import { createClient } from '@/lib/supabase/server';
import { gpa, gradeFor } from '@/lib/grading';
import { cn, formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FadeIn } from '@/components/motion';

export const metadata: Metadata = { title: 'Exams & results' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { school_slug: string };
}

interface ExamGroup {
  examName: string;
  latest: string;
  rows: {
    id: string;
    subject: string;
    marks: number;
    max: number;
    grade: string;
    passed: boolean;
    percent: number;
    remarks: string | null;
  }[];
}

export default async function PortalExamsPage({ params }: PageProps) {
  const { active } = await getPortalContext(params.school_slug);
  if (!active) return null;

  const supabase = createClient();
  const [{ data: tickets }, { data: results }] = await Promise.all([
    // RLS returns only published tickets to a student or parent.
    supabase
      .from('hall_tickets')
      .select('id, exam_name, term, created_at')
      .eq('student_id', active.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('exam_results')
      .select('id, exam_name, subject, marks_obtained, max_marks, grade, remarks, updated_at')
      .eq('student_id', active.id)
      .order('subject'),
  ]);

  const groups = new Map<string, ExamGroup>();
  for (const row of results ?? []) {
    const marks = Number(row.marks_obtained);
    const max = Number(row.max_marks);
    const computed = gradeFor(marks, max);
    const group = groups.get(row.exam_name) ?? { examName: row.exam_name, latest: row.updated_at, rows: [] };
    group.rows.push({
      id: row.id,
      subject: row.subject,
      marks,
      max,
      grade: row.grade ?? computed.grade,
      passed: computed.passed,
      percent: computed.percent,
      remarks: row.remarks,
    });
    if (row.updated_at > group.latest) group.latest = row.updated_at;
    groups.set(row.exam_name, group);
  }
  const exams = [...groups.values()].sort((a, b) => b.latest.localeCompare(a.latest));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Exams &amp; performance</h1>
        <p className="text-sm text-muted-foreground">
          Hall tickets and report cards for {active.fullName}.
        </p>
      </header>

      <section aria-labelledby="tickets-heading" className="space-y-3">
        <h2 id="tickets-heading" className="flex items-center gap-2 text-base font-semibold">
          <Ticket className="h-4 w-4 text-primary" aria-hidden />
          Hall tickets
        </h2>
        {(tickets ?? []).length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No hall tickets have been published yet.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {(tickets ?? []).map((ticket) => (
              <Card key={ticket.id}>
                <CardContent className="flex items-center gap-3 p-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Ticket className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{ticket.exam_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {ticket.term} · issued {formatDate(ticket.created_at)}
                    </p>
                  </div>
                  <a
                    href={`/hall-tickets/${ticket.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
                  >
                    View
                  </a>
                  <a
                    href={`/hall-tickets/${ticket.id}?download=1`}
                    className="rounded-md border p-1.5 hover:bg-accent"
                    aria-label={`Download hall ticket for ${ticket.exam_name}`}
                  >
                    <Download className="h-4 w-4" aria-hidden />
                  </a>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="results-heading" className="space-y-3">
        <h2 id="results-heading" className="flex items-center gap-2 text-base font-semibold">
          <Award className="h-4 w-4 text-primary" aria-hidden />
          Results &amp; report cards
        </h2>
        {exams.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No results have been published yet.
            </CardContent>
          </Card>
        ) : (
          exams.map((exam, index) => {
            const totalMarks = exam.rows.reduce((sum, row) => sum + row.marks, 0);
            const totalMax = exam.rows.reduce((sum, row) => sum + row.max, 0);
            const overall = totalMax ? Math.round((totalMarks / totalMax) * 1000) / 10 : 0;
            const examGpa = gpa(exam.rows.map((row) => ({ marks: row.marks, maxMarks: row.max })));
            const failed = exam.rows.filter((row) => !row.passed).length;
            return (
              <FadeIn key={exam.examName} delay={index * 0.05}>
                <Card className="overflow-hidden">
                  <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0 border-b py-4">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <CardTitle className="text-base">{exam.examName}</CardTitle>
                      <a
                        href={`/report-cards/${active.id}?exam=${encodeURIComponent(exam.examName)}&download=1`}
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent"
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden />
                        Report card
                      </a>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="rounded-md bg-primary/10 px-2 py-1 font-semibold text-primary">
                        GPA {examGpa?.toFixed(1) ?? '-'} / 10
                      </span>
                      <span className="rounded-md bg-muted px-2 py-1 font-medium">{overall}%</span>
                      <Badge
                        className={cn(
                          failed === 0 ? 'bg-emerald-600 text-white hover:bg-emerald-600' : 'bg-rose-600 text-white hover:bg-rose-600',
                        )}
                      >
                        {failed === 0 ? 'Passed' : `${failed} subject${failed === 1 ? '' : 's'} below pass`}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-4 py-2 font-medium">Subject</th>
                          <th className="px-4 py-2 text-right font-medium">Marks</th>
                          <th className="hidden px-4 py-2 font-medium sm:table-cell">Score</th>
                          <th className="px-4 py-2 text-center font-medium">Grade</th>
                          <th className="px-4 py-2 text-right font-medium">Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {exam.rows.map((row) => (
                          <tr key={row.id} className="border-t">
                            <td className="px-4 py-2.5">
                              <p className="font-medium">{row.subject}</p>
                              {row.remarks ? <p className="text-xs text-muted-foreground">{row.remarks}</p> : null}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                              {row.marks} / {row.max}
                            </td>
                            <td className="hidden w-40 px-4 py-2.5 sm:table-cell">
                              <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                                <div
                                  className={cn('h-full rounded-full', row.passed ? 'bg-emerald-500' : 'bg-rose-500')}
                                  style={{ width: `${Math.min(row.percent, 100)}%` }}
                                />
                              </div>
                              <span className="text-xs text-muted-foreground">{row.percent}%</span>
                            </td>
                            <td className="px-4 py-2.5 text-center font-semibold">{row.grade}</td>
                            <td className="px-4 py-2.5 text-right">
                              <span
                                className={cn(
                                  'rounded-full px-2 py-0.5 text-xs font-semibold',
                                  row.passed
                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'
                                    : 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200',
                                )}
                              >
                                {row.passed ? 'Pass' : 'Fail'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t bg-muted/30 font-semibold">
                        <tr>
                          <td className="px-4 py-2.5">Total</td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                            {totalMarks} / {totalMax}
                          </td>
                          <td className="hidden px-4 py-2.5 sm:table-cell">{overall}%</td>
                          <td className="px-4 py-2.5 text-center" colSpan={2}>
                            GPA {examGpa?.toFixed(1) ?? '-'}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </CardContent>
                </Card>
              </FadeIn>
            );
          })
        )}
        <p className="text-xs text-muted-foreground">
          Grades follow the CBSE nine-point scale (A1 to E). 33% in a subject is a pass. GPA is the
          average grade point across subjects, out of 10.
        </p>
      </section>
    </div>
  );
}
