import Link from 'next/link';
import { GraduationCap } from 'lucide-react';
import { getPortalContext } from '@/lib/portal';
import { createClient } from '@/lib/supabase/server';
import { initials } from '@/lib/utils';
import { SignOutButton } from '@/components/sign-out-button';
import { Card, CardContent } from '@/components/ui/card';
import { ChildSwitcher } from './_components/child-switcher';
import { NotificationBell } from './_components/notification-bell';
import { PortalNav } from './_components/portal-nav';

interface PortalLayoutProps {
  children: React.ReactNode;
  params: { school_slug: string };
}

/**
 * Student and parent hub: a sidebar on desktop, a scrolling tab bar on
 * phones. A parent with more than one child switches between them at the top;
 * every page shows the selected child.
 */
export default async function PortalLayout({ children, params }: PortalLayoutProps) {
  const { userId, profile, school, students, active } = await getPortalContext(params.school_slug);
  const { count: unread } = await createClient()
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false);
  const portalName = profile.role === 'PARENT' ? 'Parent portal' : 'Student portal';

  return (
    <div className="min-h-screen bg-muted/30 lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="border-b bg-background lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-3 px-4 py-3 lg:py-5">
          <Link href={`/${school.slug}/portal`} className="flex min-w-0 items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <GraduationCap className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold leading-tight">{school.name}</span>
              <span className="block text-xs text-muted-foreground">{portalName}</span>
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-1">
            <NotificationBell schoolSlug={school.slug} userId={userId} initialUnread={unread ?? 0} />
            <div className="flex items-center gap-1 lg:hidden">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold"
                title={profile.full_name || profile.email || undefined}
              >
                {initials(profile.full_name || profile.email || 'P')}
              </span>
              <SignOutButton showLabel={false} />
            </div>
          </div>
        </div>

        {students.length > 0 && active ? (
          <div className="px-3 pb-3">
            <ChildSwitcher
              schoolSlug={school.slug}
              activeId={active.id}
              students={students.map((student) => ({
                id: student.id,
                fullName: student.fullName,
                classLabel: `Class ${student.classGrade}-${student.section}`,
                photoUrl: student.photoUrl,
              }))}
            />
          </div>
        ) : null}

        <PortalNav schoolSlug={school.slug} />

        <div className="hidden border-t px-4 py-4 lg:block">
          <p className="truncate text-sm font-medium">{profile.full_name || profile.email}</p>
          <SignOutButton className="mt-2 w-full justify-start px-0" />
        </div>
      </aside>

      <main className="mx-auto w-full min-w-0 max-w-5xl px-4 py-6 lg:px-8">
        {active ? (
          children
        ) : (
          <Card>
            <CardContent className="space-y-2 py-12 text-center">
              <p className="font-medium">No student is linked to this account yet.</p>
              <p className="text-sm text-muted-foreground">
                Ask the school office to link your login
                {school.contact_phone ? ` (${school.contact_phone})` : ''}.
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
