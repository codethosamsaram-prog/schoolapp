'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import type { NotificationRow } from '@/types/database';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/ui/use-toast';

interface NotificationBellProps {
  schoolSlug: string;
  userId: string;
  initialUnread: number;
}

/**
 * A system alert when the portal is in a background tab and the user turned
 * alerts on (notifications page). A visible tab already shows the toast. Some
 * mobile browsers refuse this constructor, so a failure just skips the alert.
 */
function showBrowserAlert(row: NotificationRow) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || !document.hidden) return;
  try {
    new Notification(row.title, { body: row.body, tag: row.id });
  } catch {
    // The toast and the badge still show when they come back.
  }
}

/**
 * Unread count for the portal header, kept live over Supabase Realtime.
 * postgres_changes applies the notifications select policy to this
 * subscriber, so only the user's own rows arrive; the filter just keeps the
 * server from evaluating everyone else's. A new notification also shows a
 * toast and refreshes the page underneath, so lists on screen catch up.
 */
export function NotificationBell({ schoolSlug, userId, initialUnread }: NotificationBellProps) {
  const [unread, setUnread] = React.useState(initialUnread);
  const { toast } = useToast();
  const router = useRouter();

  // The layout re-renders with a fresh count after marking read.
  React.useEffect(() => setUnread(initialUnread), [initialUnread]);

  React.useEffect(() => {
    const supabase = createClient();

    async function recount() {
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_read', false);
      if (typeof count === 'number') setUnread(count);
    }

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let unmounted = false;

    async function subscribe() {
      // The client loads its session asynchronously. Joining before that would
      // subscribe as anon, which Realtime refuses with "invalid column for
      // filter", so it gets the user's token first. Refreshes then follow it.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) await supabase.realtime.setAuth(session.access_token);
      if (unmounted) return;

      channel = supabase
        .channel(`notifications:${userId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
          (payload) => {
            const row = payload.new as NotificationRow;
            // A recount, not +1: router.refresh() below brings back a server
            // count that may already include this row.
            void recount();
            toast({ title: row.title, description: row.body });
            showBrowserAlert(row);
            router.refresh();
          },
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
          () => void recount(),
        )
        .subscribe((status) => {
          // Anything that arrived before the socket was up.
          if (status === 'SUBSCRIBED') void recount();
        });
    }

    void subscribe();

    return () => {
      unmounted = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [userId, toast, router]);

  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';

  return (
    <Link
      href={`/${schoolSlug}/portal/notifications`}
      aria-label={label}
      title={label}
      data-unread={unread}
      className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <Bell className="h-5 w-5" aria-hidden />
      {unread > 0 ? (
        <span
          data-testid="unread-badge"
          className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground"
        >
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </Link>
  );
}
