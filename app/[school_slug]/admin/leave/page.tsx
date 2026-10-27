import type { Metadata } from 'next';
import Link from 'next/link';
import type { LeaveStatus } from '@/types/database';
import { requireTenantSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { LEAVE_STATUS_META } from '@/lib/leave';
import { cn } from '@/lib/utils';
import { LeaveList } from '../../_leave/leave-components';
import { LEAVE_SELECT, toLeaveRows } from '../../_leave/rows';

export const metadata: Metadata = { title: 'Leave approvals' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { school_slug: string };
  searchParams: { status?: string; kind?: string };
}

const STATUSES: LeaveStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];
const KINDS = { ALL: 'Everyone', STUDENT: 'Students', STAFF: 'Staff' } as const;

export default async function AdminLeavePage({ params, searchParams }: PageProps) {
  const { userId, profile, school } = await requireTenantSession(params.school_slug, [
    'SUPER_ADMIN',
    'SCHOOL_ADMIN',
  ]);
  const status = STATUSES.includes(searchParams.status as LeaveStatus)
    ? (searchParams.status as LeaveStatus)
    : 'PENDING';
  const kind = searchParams.kind === 'STUDENT' || searchParams.kind === 'STAFF' ? searchParams.kind : 'ALL';

  const supabase = createClient();
  let query = supabase
    .from('leave_requests')
    .select(LEAVE_SELECT)
    .eq('school_id', school.id)
    .eq('status', status)
    .order('start_date', { ascending: status === 'PENDING' })
    .limit(200);
  if (kind !== 'ALL') query = query.eq('applicant_kind', kind);

  const [{ data }, { count: pendingCount }] = await Promise.all([
    query,
    supabase
      .from('leave_requests')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', school.id)
      .eq('status', 'PENDING'),
  ]);
  const rows = await toLeaveRows(supabase, data, { userId, role: profile.role });

  const href = (next: { status?: string; kind?: string }) => {
    const query = new URLSearchParams({ status: next.status ?? status, kind: next.kind ?? kind });
    return `/${school.slug}/admin/leave?${query.toString()}`;
  };
  const pill = (active: boolean) =>
    cn(
      'rounded-md px-2.5 py-1 text-xs font-medium',
      active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
    );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 lg:px-8 lg:py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">Leave approvals</h1>
        <p className="text-sm text-muted-foreground">
          {pendingCount ?? 0} waiting for a decision. Approved student leave is recorded in attendance as on
          leave.
        </p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter by status" className="flex flex-wrap gap-1">
          {STATUSES.map((value) => (
            <Link key={value} href={href({ status: value })} aria-current={value === status ? 'page' : undefined} className={pill(value === status)}>
              {LEAVE_STATUS_META[value].label}
            </Link>
          ))}
        </nav>
        <nav aria-label="Filter by applicant" className="flex flex-wrap gap-1">
          {Object.entries(KINDS).map(([value, label]) => (
            <Link key={value} href={href({ kind: value })} aria-current={value === kind ? 'page' : undefined} className={pill(value === kind)}>
              {label}
            </Link>
          ))}
        </nav>
      </div>

      <LeaveList
        schoolSlug={school.slug}
        rows={rows}
        showApplicant
        empty={`No ${LEAVE_STATUS_META[status].label.toLowerCase()} applications.`}
      />
    </div>
  );
}
