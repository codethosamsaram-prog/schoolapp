import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarClock, Paperclip } from 'lucide-react';
import { getPortalContext } from '@/lib/portal';
import { homeworkFor } from '@/lib/portal-queries';
import { createClient } from '@/lib/supabase/server';
import { signedUrls } from '@/lib/storage';
import { cn, formatDate, todayInIST } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Stagger } from '@/components/motion';

export const metadata: Metadata = { title: 'Homework' };
export const dynamic = 'force-dynamic';

type Filter = 'upcoming' | 'past' | 'all';

interface PageProps {
  params: { school_slug: string };
  searchParams: { show?: string; subject?: string };
}

function daysUntil(today: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export default async function PortalHomeworkPage({ params, searchParams }: PageProps) {
  const { active, school } = await getPortalContext(params.school_slug);
  if (!active) return null;

  const filter: Filter = searchParams.show === 'past' || searchParams.show === 'all' ? searchParams.show : 'upcoming';
  const today = todayInIST();
  const supabase = createClient();

  let query = homeworkFor(supabase, school.id, active);
  if (filter === 'upcoming') query = query.gte('due_date', today).order('due_date', { ascending: true });
  else if (filter === 'past') query = query.lt('due_date', today).order('due_date', { ascending: false });
  else query = query.order('due_date', { ascending: false });

  const { data } = await query.limit(100);
  const all = data ?? [];
  const subjects = [...new Set(all.map((item) => item.subject))].sort();
  const subject = searchParams.subject && subjects.includes(searchParams.subject) ? searchParams.subject : null;
  const items = subject ? all.filter((item) => item.subject === subject) : all;
  const links = await signedUrls(
    supabase,
    'academic-docs',
    items.flatMap((item) => item.attachments.map((file) => file.path)),
  );

  const base = `/${school.slug}/portal/homework`;
  const href = (next: { show?: Filter; subject?: string | null }) => {
    const params = new URLSearchParams();
    const show = next.show ?? filter;
    if (show !== 'upcoming') params.set('show', show);
    const sub = next.subject === undefined ? subject : next.subject;
    if (sub) params.set('subject', sub);
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Homework</h1>
        <p className="text-sm text-muted-foreground">
          Class {active.classGrade}-{active.section}, sorted by due date.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex gap-1 rounded-lg bg-muted p-1 text-sm font-medium" aria-label="Due date">
          {(['upcoming', 'past', 'all'] as const).map((value) => (
            <Link
              key={value}
              href={href({ show: value })}
              aria-current={filter === value ? 'page' : undefined}
              className={cn(
                'rounded-md px-3 py-1 capitalize',
                filter === value ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {value === 'upcoming' ? 'Due soon' : value}
            </Link>
          ))}
        </nav>
        {subjects.length > 1 ? (
          <nav className="flex flex-wrap gap-1" aria-label="Subject">
            <Link
              href={href({ subject: null })}
              className={cn('rounded-full border px-3 py-1 text-xs', !subject && 'border-primary bg-primary/10 text-primary')}
            >
              All subjects
            </Link>
            {subjects.map((name) => (
              <Link
                key={name}
                href={href({ subject: name })}
                className={cn('rounded-full border px-3 py-1 text-xs', subject === name && 'border-primary bg-primary/10 text-primary')}
              >
                {name}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {filter === 'upcoming' ? 'No homework due. Enjoy the break!' : 'No homework here.'}
          </CardContent>
        </Card>
      ) : (
        <Stagger className="space-y-3">
          {items.map((item) => {
            const days = daysUntil(today, item.due_date);
            const urgency =
              days < 0
                ? { label: `Was due ${formatDate(item.due_date)}`, className: 'text-muted-foreground' }
                : days === 0
                  ? { label: 'Due today', className: 'text-rose-600 font-semibold' }
                  : days === 1
                    ? { label: 'Due tomorrow', className: 'text-amber-700 font-semibold' }
                    : { label: `Due ${formatDate(item.due_date, { weekday: 'short', day: '2-digit', month: 'short' })}`, className: 'text-foreground' };
            return (
              <Card key={item.id}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{item.subject}</Badge>
                    <span className={cn('inline-flex items-center gap-1 text-xs', urgency.className)}>
                      <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                      {urgency.label}
                    </span>
                  </div>
                  <p className="font-semibold">{item.title}</p>
                  {item.description ? (
                    <p className="whitespace-pre-line text-sm text-muted-foreground">{item.description}</p>
                  ) : null}
                  {item.attachments.length > 0 ? (
                    <ul className="flex flex-wrap gap-2 pt-1">
                      {item.attachments.map((file) =>
                        links.get(file.path) ? (
                          <li key={file.path}>
                            <a
                              href={links.get(file.path)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent"
                            >
                              <Paperclip className="h-3.5 w-3.5" aria-hidden />
                              {file.name}
                            </a>
                          </li>
                        ) : null,
                      )}
                    </ul>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </Stagger>
      )}
    </div>
  );
}
