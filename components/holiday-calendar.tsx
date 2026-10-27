import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CalendarHoliday {
  id: string;
  title: string;
  date: string;
  description: string | null;
  isAcademicHoliday: boolean;
}

interface HolidayCalendarProps {
  /** 'YYYY-MM' */
  month: string;
  today: string;
  holidays: CalendarHoliday[];
  /** Base URL; ?month=YYYY-MM is appended for navigation. */
  basePath: string;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, m - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

/**
 * Month grid, Monday first, with holidays and school events marked. Rendered
 * on the server; month navigation is plain links.
 */
export function HolidayCalendar({ month, today, holidays, basePath }: HolidayCalendarProps) {
  const [year, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const leading = (first.getUTCDay() + 6) % 7; // Monday = 0
  const cells: (number | null)[] = [
    ...Array<null>(leading).fill(null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const byDate = new Map<string, CalendarHoliday[]>();
  for (const holiday of holidays) {
    byDate.set(holiday.date, [...(byDate.get(holiday.date) ?? []), holiday]);
  }

  const title = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
  const separator = basePath.includes('?') ? '&' : '?';

  return (
    <div className="rounded-xl border bg-background">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <Link
          href={`${basePath}${separator}month=${shiftMonth(month, -1)}`}
          className="rounded-md p-1.5 hover:bg-accent"
          aria-label="Previous month"
          scroll={false}
        >
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <h2 className="text-sm font-semibold">{title}</h2>
        <Link
          href={`${basePath}${separator}month=${shiftMonth(month, 1)}`}
          className="rounded-md p-1.5 hover:bg-accent"
          aria-label="Next month"
          scroll={false}
        >
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid grid-cols-7 border-b text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {WEEKDAYS.map((day) => (
          <div key={day} className="py-2">
            <span className="sm:hidden">{day[0]}</span>
            <span className="hidden sm:inline">{day}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((day, index) => {
          if (day === null) return <div key={`blank-${index}`} className="min-h-12 border-b border-r bg-muted/20 sm:min-h-20" />;
          const iso = `${month}-${String(day).padStart(2, '0')}`;
          const events = byDate.get(iso) ?? [];
          const isSunday = index % 7 === 6;
          const holiday = events.some((event) => event.isAcademicHoliday);
          return (
            <div
              key={iso}
              className={cn(
                'min-h-12 min-w-0 border-b border-r p-1 sm:min-h-20 sm:p-1.5',
                holiday && 'bg-rose-50 dark:bg-rose-950/30',
                !holiday && events.length > 0 && 'bg-sky-50 dark:bg-sky-950/30',
              )}
            >
              <span
                className={cn(
                  'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs',
                  iso === today && 'bg-primary font-semibold text-primary-foreground',
                  iso !== today && (isSunday || holiday) && 'text-rose-600',
                )}
                aria-label={events.length ? `${iso}: ${events.map((event) => event.title).join(', ')}` : undefined}
              >
                {day}
              </span>
              {events.map((event) => (
                <p
                  key={event.id}
                  className={cn(
                    'mt-0.5 hidden truncate rounded px-1 text-[10px] font-medium sm:block',
                    event.isAcademicHoliday
                      ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200'
                      : 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200',
                  )}
                  title={event.title}
                >
                  {event.title}
                </p>
              ))}
              {events.length > 0 ? (
                <span
                  className={cn(
                    'mx-auto mt-0.5 block h-1.5 w-1.5 rounded-full sm:hidden',
                    holiday ? 'bg-rose-500' : 'bg-sky-500',
                  )}
                  aria-hidden
                />
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-4 px-4 py-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-rose-400" /> Holiday
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-sky-400" /> School event
        </span>
      </div>
    </div>
  );
}
