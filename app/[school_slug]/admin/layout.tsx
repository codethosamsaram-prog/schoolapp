import Link from 'next/link';
import {
  BookOpenCheck,
  CalendarCheck,
  CalendarDays,
  GraduationCap,
  Megaphone,
  LayoutDashboard,
  ReceiptIndianRupee,
  UserPlus,
  Users,
  BriefcaseBusiness,
  Bus,
  CalendarOff,
  QrCode,
} from 'lucide-react';
import { requireTenantSession } from '@/lib/auth';
import { Badge } from '@/components/ui/badge';
import { initials } from '@/lib/utils';
import { SignOutButton } from '@/components/sign-out-button';

interface AdminLayoutProps {
  children: React.ReactNode;
  params: { school_slug: string };
}

/**
 * Admin shell. The guard runs here so every nested admin route inherits it;
 * an authenticated teacher or a member of another tenant is redirected before
 * any query is issued.
 */
export default async function AdminLayout({ children, params }: AdminLayoutProps) {
  const { profile, school } = await requireTenantSession(params.school_slug, [
    'SUPER_ADMIN',
    'SCHOOL_ADMIN',
  ]);

  const nav = [
    { href: `/${school.slug}/admin/dashboard`, label: 'Dashboard', icon: LayoutDashboard },
    { href: `/${school.slug}/admin/admissions`, label: 'Admissions', icon: UserPlus },
    { href: `/${school.slug}/admin/students`, label: 'Students', icon: Users },
    { href: `/${school.slug}/admin/fees`, label: 'Fees', icon: ReceiptIndianRupee },
    { href: `/${school.slug}/admin/finance/utr-verification`, label: 'UPI verification', icon: QrCode },
    { href: `/${school.slug}/admin/staff`, label: 'Staff & payroll', icon: BriefcaseBusiness },
    { href: `/${school.slug}/admin/transport`, label: 'Transport', icon: Bus },
    { href: `/${school.slug}/admin/leave`, label: 'Leave approvals', icon: CalendarOff },
    { href: `/${school.slug}/admin/calendar`, label: 'Calendar', icon: CalendarDays },
    { href: `/${school.slug}/teacher/attendance`, label: 'Attendance', icon: CalendarCheck },
    { href: `/${school.slug}/teacher/announcements`, label: 'Announcements', icon: Megaphone },
    { href: `/${school.slug}/teacher/exams`, label: 'Exams & homework', icon: BookOpenCheck },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-muted/30 lg:flex-row">
      <aside className="border-b bg-background lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-3 px-4 py-4 lg:py-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            <GraduationCap className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{school.name}</p>
            <p className="text-xs text-muted-foreground">Administration</p>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-2 pb-3 lg:flex-col lg:overflow-visible lg:px-3">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </Link>
          ))}
          <SignOutButton className="shrink-0 px-3 lg:hidden" />
        </nav>

        <div className="hidden border-t px-4 py-4 lg:block">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
              {initials(profile.full_name || profile.email || 'AD')}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{profile.full_name || 'Administrator'}</p>
              <Badge variant="secondary" className="mt-0.5 text-[10px]">
                {profile.role.replace('_', ' ')}
              </Badge>
            </div>
          </div>
          <SignOutButton className="mt-3 w-full justify-start" />
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
