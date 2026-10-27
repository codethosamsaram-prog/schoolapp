import type { Metadata } from 'next';
import { requireTenantSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatDate, todayInIST } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DeleteItemButton } from '@/components/delete-item-button';
import { HolidayCalendar, shiftMonth } from '@/components/holiday-calendar';
import { deleteHoliday } from '../../teacher/content-actions';
import { HolidayForm } from './holiday-form';

export const metadata: Metadata = { title: 'Holiday calendar' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { school_slug: string };
  searchParams: { month?: string };
}

export default async function AdminCalendarPage({ params, searchParams }: PageProps) {
  const { school } = await requireTenantSession(params.school_slug, ['SUPER_ADMIN', 'SCHOOL_ADMIN']);
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
      .limit(30),
  ]);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 lg:px-8 lg:py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">Holiday calendar</h1>
        <p className="text-sm text-muted-foreground">
          Holidays and school events appear on every student and parent portal, and upcoming
          holidays are printed on hall tickets.
        </p>
      </header>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <HolidayCalendar
          month={month}
          today={today}
          basePath={`/${school.slug}/admin/calendar`}
          holidays={(monthRows ?? []).map((row) => ({
            id: row.id,
            title: row.title,
            date: row.date,
            description: row.description,
            isAcademicHoliday: row.is_academic_holiday,
          }))}
        />

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add a day</CardTitle>
            </CardHeader>
            <CardContent>
              <HolidayForm schoolSlug={school.slug} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Upcoming</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(upcoming ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
              ) : (
                (upcoming ?? []).map((row) => (
                  <div key={row.id} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{row.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(row.date, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                    <Badge variant={row.is_academic_holiday ? 'destructive' : 'secondary'} className="text-[10px]">
                      {row.is_academic_holiday ? 'Holiday' : 'Event'}
                    </Badge>
                    <DeleteItemButton
                      action={deleteHoliday.bind(null, school.slug, row.id)}
                      label={`Remove ${row.title}`}
                      confirmText={`Remove ${row.title} from the calendar?`}
                    />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
