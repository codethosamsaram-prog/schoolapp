import type { Metadata } from 'next';
import { getPortalContext } from '@/lib/portal';
import { createClient } from '@/lib/supabase/server';
import { formatDate, todayInIST } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { HolidayCalendar, shiftMonth } from '@/components/holiday-calendar';

export const metadata: Metadata = { title: 'Holiday calendar' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { school_slug: string };
  searchParams: { month?: string };
}

export default async function PortalCalendarPage({ params, searchParams }: PageProps) {
  const { active, school } = await getPortalContext(params.school_slug);
  if (!active) return null;

  const today = todayInIST();
  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? '') ? (searchParams.month as string) : today.slice(0, 7);

  const supabase = createClient();
  const [{ data: monthRows }, { data: upcoming }] = await Promise.all([
    supabase
      .from('holiday_calendar')
      .select('id, title, date, description, is_academic_holiday')
      .eq('school_id', school.id)
      .gte('date', `${month}-01`)
      .lt('date', `${shiftMonth(month, 1)}-01`),
    supabase
      .from('holiday_calendar')
      .select('id, title, date, description, is_academic_holiday')
      .eq('school_id', school.id)
      .gte('date', today)
      .order('date')
      .limit(10),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Holiday calendar</h1>
        <p className="text-sm text-muted-foreground">Holidays and school events for {school.name}.</p>
      </header>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <HolidayCalendar
          month={month}
          today={today}
          basePath={`/${school.slug}/portal/calendar`}
          holidays={(monthRows ?? []).map((row) => ({
            id: row.id,
            title: row.title,
            date: row.date,
            description: row.description,
            isAcademicHoliday: row.is_academic_holiday,
          }))}
        />

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Coming up</CardTitle>
          </CardHeader>
          <CardContent>
            {(upcoming ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
            ) : (
              <ul className="space-y-3">
                {(upcoming ?? []).map((row) => (
                  <li key={row.id} className="flex gap-3">
                    <div className="w-12 shrink-0 rounded-md border text-center">
                      <p className="bg-muted text-[10px] font-semibold uppercase">
                        {formatDate(row.date, { month: 'short' })}
                      </p>
                      <p className="py-0.5 text-lg font-bold">{formatDate(row.date, { day: '2-digit' })}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{row.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(row.date, { weekday: 'long' })}
                        {row.description ? ` · ${row.description}` : ''}
                      </p>
                      <Badge variant={row.is_academic_holiday ? 'destructive' : 'secondary'} className="mt-1 text-[10px]">
                        {row.is_academic_holiday ? 'Holiday' : 'School event'}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
