import type { Metadata } from 'next';
import { Download, FileText } from 'lucide-react';
import { getPortalContext } from '@/lib/portal';
import { createClient } from '@/lib/supabase/server';
import { signedUrls } from '@/lib/storage';
import { formatDate } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { HoverLift } from '@/components/motion';

export const metadata: Metadata = { title: 'Syllabus' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { school_slug: string };
}

export default async function PortalSyllabusPage({ params }: PageProps) {
  const { active, school } = await getPortalContext(params.school_slug);
  if (!active) return null;

  const supabase = createClient();
  const { data: academicYear } = await supabase.rpc('current_academic_year');
  const { data } = await supabase
    .from('syllabus_copies')
    .select('*')
    .eq('school_id', school.id)
    .eq('class_grade', active.classGrade)
    .eq('academic_year', academicYear ?? '')
    .order('subject');

  const rows = data ?? [];
  const links = await signedUrls(supabase, 'academic-docs', rows.map((row) => row.pdf_url));

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Syllabus</h1>
        <p className="text-sm text-muted-foreground">
          Course guides for Class {active.classGrade}, {academicYear}.
        </p>
      </header>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Your school has not published the syllabus for this class yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => {
            const href = links.get(row.pdf_url);
            return (
              <HoverLift key={row.id}>
                <Card className="h-full">
                  <CardContent className="flex h-full flex-col gap-3 p-4">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <FileText className="h-5 w-5" aria-hidden />
                    </span>
                    <div className="flex-1">
                      <p className="font-semibold">{row.subject}</p>
                      <p className="text-xs text-muted-foreground">Updated {formatDate(row.updated_at)}</p>
                    </div>
                    {href ? (
                      <div className="flex gap-2">
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex flex-1 items-center justify-center rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
                        >
                          Open
                        </a>
                        <a
                          href={`${href}&download=${encodeURIComponent(`${row.subject} syllabus - Class ${row.class_grade}.pdf`)}`}
                          className="inline-flex items-center justify-center rounded-md border px-3 py-1.5 hover:bg-accent"
                          aria-label={`Download ${row.subject} syllabus`}
                        >
                          <Download className="h-4 w-4" aria-hidden />
                        </a>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">File unavailable</p>
                    )}
                  </CardContent>
                </Card>
              </HoverLift>
            );
          })}
        </div>
      )}
    </div>
  );
}
