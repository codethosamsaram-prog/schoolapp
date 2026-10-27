import Link from 'next/link';
import { GraduationCap, LayoutDashboard } from 'lucide-react';
import { requireTenantSession, canManageSchool } from '@/lib/auth';
import { initials } from '@/lib/utils';
import { SignOutButton } from '@/components/sign-out-button';
import { StaffNav } from './_components/staff-nav';

interface TeacherLayoutProps {
  children: React.ReactNode;
  params: { school_slug: string };
}

/** Staff shell. Admins are allowed through so they can cover for teachers. */
export default async function TeacherLayout({ children, params }: TeacherLayoutProps) {
  const { profile, school } = await requireTenantSession(params.school_slug, [
    'SUPER_ADMIN',
    'SCHOOL_ADMIN',
    'TEACHER',
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link href={`/${school.slug}/teacher/attendance`} className="flex min-w-0 items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <GraduationCap className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold leading-tight">{school.name}</span>
              <span className="block text-xs text-muted-foreground">Staff room</span>
            </span>
          </Link>

          <div className="flex items-center gap-1">
            {canManageSchool(profile.role) ? (
              <Link
                href={`/${school.slug}/admin/dashboard`}
                className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <LayoutDashboard className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">Admin</span>
              </Link>
            ) : null}
            <span
              className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-xs font-semibold"
              title={profile.full_name || 'Teacher'}
            >
              {initials(profile.full_name || profile.email || 'TR')}
            </span>
            <SignOutButton showLabel={false} />
          </div>
        </div>
        <StaffNav schoolSlug={school.slug} />
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5">{children}</main>
    </div>
  );
}
