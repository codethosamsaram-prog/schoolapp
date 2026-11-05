import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarCheck, CalendarOff, IndianRupee, Megaphone, type LucideIcon } from 'lucide-react';
import type { NotificationType } from '@/types/database';
import { getPortalContext } from '@/lib/portal';
import { createClient } from '@/lib/supabase/server';
import { cn, formatDate } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { BrowserAlertsButton } from './browser-alerts-button';
import { MarkReadButton } from './mark-read-button';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { school_slug: string };
}

const ICONS: Record<NotificationType, LucideIcon> = {
  FEE: IndianRupee,
  LEAVE: CalendarOff,
  ATTENDANCE: CalendarCheck,
  ANNOUNCEMENT: Megaphone,
};

const PAGE_SIZE = 100;

/**
 * The notification ledger for this login: fee reminders and receipts, leave
 * decisions, absence alerts and announcements. New ones arrive live through
 * the header bell, which refreshes this page.
 */
export default async function NotificationsPage({ params }: PageProps) {
  const { userId, school } = await getPortalContext(params.school_slug);

  const { data } = await createClient()
    .from('notifications')
    .select('id, title, body, type, link, is_read, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);
  const rows = data ?? [];
  const unread = rows.filter((row) => !row.is_read).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            {unread > 0 ? `${unread} unread` : 'You are all caught up.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <BrowserAlertsButton />
          {unread > 0 ? <MarkReadButton schoolSlug={school.slug} /> : null}
        </div>
      </header>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-muted-foreground">
              Fee reminders, receipts, leave decisions and school announcements will appear here.
            </p>
          ) : (
            <ul className="divide-y" aria-label="Notifications">
              {rows.map((row) => {
                const Icon = ICONS[row.type];
                const content = (
                  <>
                    <span
                      className={cn(
                        'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                        row.is_read ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary',
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={cn('truncate text-sm', row.is_read ? 'font-medium' : 'font-semibold')}>
                          {row.title}
                        </span>
                        {!row.is_read ? (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />
                        ) : null}
                      </span>
                      <span className="block break-words text-sm text-muted-foreground">{row.body}</span>
                      <span className="block text-xs text-muted-foreground">{formatDate(row.created_at)}</span>
                    </span>
                  </>
                );
                return (
                  <li key={row.id} data-read={row.is_read} className={cn(!row.is_read && 'bg-primary/[0.03]')}>
                    {row.link ? (
                      <Link href={row.link} className="flex gap-3 px-5 py-4 hover:bg-accent/50">
                        {content}
                      </Link>
                    ) : (
                      <div className="flex gap-3 px-5 py-4">{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
