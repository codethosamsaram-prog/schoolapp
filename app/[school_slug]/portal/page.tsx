import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, CalendarCheck, CalendarDays, IndianRupee, Megaphone, NotebookPen, PlayCircle } from 'lucide-react';
import { getPortalContext } from '@/lib/portal';
import { announcementsFor, homeworkFor, videosFor } from '@/lib/portal-queries';
import { createClient } from '@/lib/supabase/server';
import { cn, formatDate, formatDateTime, formatINR, percent, todayInIST } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FadeIn, HoverLift, Stagger } from '@/components/motion';
import { YouTubeEmbed } from './_components/youtube-embed';
import { BusCard } from './_components/bus-card';

export const metadata: Metadata = { title: 'Home' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { school_slug: string };
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export default async function PortalHomePage({ params }: PageProps) {
  const { active, school, profile } = await getPortalContext(params.school_slug);
  if (!active) return null;

  const supabase = createClient();
  const today = todayInIST();
  const monthStart = `${today.slice(0, 7)}-01`;

  const [announcements, videos, homework, attendance, holiday] = await Promise.all([
    announcementsFor(supabase, school.id, active),
    videosFor(supabase, school.id, active),
    homeworkFor(supabase, school.id, active).gte('due_date', today).lte('due_date', addDays(today, 7)),
    supabase.from('attendance').select('status').eq('student_id', active.id).gte('date', monthStart),
    supabase
      .from('holiday_calendar')
      .select('title, date')
      .eq('school_id', school.id)
      .gte('date', today)
      .order('date')
      .limit(1)
      .maybeSingle(),
  ]);

  const marked = attendance.data ?? [];
  const attended = marked.filter((row) => row.status === 'PRESENT' || row.status === 'LATE').length;
  const firstName = (profile.role === 'STUDENT' ? active.fullName : profile.full_name).split(' ')[0];

  const stats = [
    {
      href: 'fees',
      label: 'Balance due',
      value: formatINR(active.currentBalance),
      hint: active.currentBalance > 0 ? 'Pay online' : 'Fully paid',
      icon: IndianRupee,
      tone: active.currentBalance > 0 ? 'text-amber-700 bg-amber-100' : 'text-emerald-700 bg-emerald-100',
    },
    {
      href: 'profile',
      label: 'Attendance this month',
      value: marked.length ? percent(attended, marked.length, 0) : '-',
      hint: marked.length ? `${attended} of ${marked.length} days` : 'Not marked yet',
      icon: CalendarCheck,
      tone: 'text-primary bg-primary/10',
    },
    {
      href: 'homework',
      label: 'Homework due this week',
      value: String(homework.data?.length ?? 0),
      hint: homework.data?.[0] ? `Next: ${homework.data[0].subject}` : 'All clear',
      icon: NotebookPen,
      tone: 'text-violet-700 bg-violet-100',
    },
    {
      href: 'calendar',
      label: 'Next holiday',
      value: holiday.data ? formatDate(holiday.data.date, { day: '2-digit', month: 'short' }) : '-',
      hint: holiday.data?.title ?? 'None scheduled',
      icon: CalendarDays,
      tone: 'text-sky-700 bg-sky-100',
    },
  ];

  return (
    <div className="space-y-6">
      <FadeIn>
        <h1 className="text-2xl font-bold tracking-tight">Hello{firstName ? `, ${firstName}` : ''}</h1>
        <p className="text-sm text-muted-foreground">
          {profile.role === 'PARENT' ? `${active.fullName} · ` : ''}Class {active.classGrade}-{active.section} ·{' '}
          {formatDate(today, { weekday: 'long', day: '2-digit', month: 'long' })}
        </p>
      </FadeIn>

      <Stagger className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ href, label, value, hint, icon: Icon, tone }) => (
          <HoverLift key={label}>
            <Link href={`/${school.slug}/portal/${href}`} className="block">
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardContent className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
                    <p className="mt-1 text-xl font-bold">{value}</p>
                    <p className="truncate text-xs text-muted-foreground">{hint}</p>
                  </div>
                  <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', tone)}>
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                </CardContent>
              </Card>
            </Link>
          </HoverLift>
        ))}
      </Stagger>

      <BusCard studentId={active.id} />

      <div className="grid gap-6 xl:grid-cols-[1fr_1.1fr]">
        <section aria-labelledby="announcements-heading" className="space-y-3">
          <h2 id="announcements-heading" className="flex items-center gap-2 text-base font-semibold">
            <Megaphone className="h-4 w-4 text-primary" aria-hidden />
            School announcements
          </h2>
          {(announcements.data ?? []).length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No announcements yet.
              </CardContent>
            </Card>
          ) : (
            <Stagger className="space-y-3">
              {(announcements.data ?? []).map((item) => (
                <Card key={item.id}>
                  <CardContent className="space-y-1.5 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{item.title}</p>
                      {item.target_type !== 'ALL' ? (
                        <Badge variant="secondary">
                          Class {item.target_grade}
                          {item.target_section ? `-${item.target_section}` : ''}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="whitespace-pre-line text-sm text-muted-foreground">{item.content}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(item.created_at)}</p>
                  </CardContent>
                </Card>
              ))}
            </Stagger>
          )}
        </section>

        <section aria-labelledby="videos-heading" className="space-y-3">
          <h2 id="videos-heading" className="flex items-center gap-2 text-base font-semibold">
            <PlayCircle className="h-4 w-4 text-red-600" aria-hidden />
            Video references
          </h2>
          {(videos.data ?? []).length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Your teachers have not shared any videos yet.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              {(videos.data ?? []).map((video) => (
                <Card key={video.id} className="overflow-hidden">
                  <YouTubeEmbed url={video.youtube_url} title={video.title} />
                  <CardHeader className="space-y-1 p-4">
                    <Badge variant="outline" className="w-fit">
                      {video.subject}
                    </Badge>
                    <CardTitle className="text-sm">{video.title}</CardTitle>
                    {video.description ? (
                      <p className="text-xs text-muted-foreground">{video.description}</p>
                    ) : null}
                  </CardHeader>
                </Card>
              ))}
            </div>
          )}
          <Link
            href={`/${school.slug}/portal/homework`}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            See homework
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </section>
      </div>
    </div>
  );
}
