import type { Metadata } from 'next';
import { requireTenantSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LeaveForm, LeaveList } from '../../_leave/leave-components';
import { LEAVE_SELECT, toLeaveRows } from '../../_leave/rows';

export const metadata: Metadata = { title: 'Leave' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { school_slug: string };
}

/** Staff apply for their own leave here, and teachers review student leave. */
export default async function StaffLeavePage({ params }: PageProps) {
  const { userId, profile, school } = await requireTenantSession(params.school_slug, [
    'SUPER_ADMIN',
    'SCHOOL_ADMIN',
    'TEACHER',
  ]);
  const supabase = createClient();
  const viewer = { userId, role: profile.role };

  const [mine, pending, decided] = await Promise.all([
    supabase
      .from('leave_requests')
      .select(LEAVE_SELECT)
      .eq('staff_user_id', userId)
      .order('start_date', { ascending: false })
      .limit(30),
    supabase
      .from('leave_requests')
      .select(LEAVE_SELECT)
      .eq('school_id', school.id)
      .eq('applicant_kind', 'STUDENT')
      .eq('status', 'PENDING')
      .order('start_date'),
    supabase
      .from('leave_requests')
      .select(LEAVE_SELECT)
      .eq('school_id', school.id)
      .eq('applicant_kind', 'STUDENT')
      .neq('status', 'PENDING')
      .order('reviewed_at', { ascending: false, nullsFirst: false })
      .limit(15),
  ]);

  const [myRows, pendingRows, decidedRows] = await Promise.all([
    toLeaveRows(supabase, mine.data, viewer),
    toLeaveRows(supabase, pending.data, viewer),
    toLeaveRows(supabase, decided.data, viewer),
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight">Leave</h1>
        <p className="text-sm text-muted-foreground">
          Review student leave, and apply for your own. Staff leave is approved by the school office.
        </p>
      </header>

      <section aria-labelledby="student-leave" className="space-y-3">
        <h2 id="student-leave" className="text-base font-semibold">
          Student requests awaiting review ({pendingRows.length})
        </h2>
        <LeaveList
          schoolSlug={school.slug}
          rows={pendingRows}
          showApplicant
          empty="No student leave is waiting for review."
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card className="h-fit">
          <CardHeader className="border-b py-4">
            <CardTitle className="text-base">Apply for your leave</CardTitle>
          </CardHeader>
          <CardContent className="pt-5">
            <LeaveForm schoolSlug={school.slug} applicantLabel={profile.full_name || profile.email || 'you'} />
          </CardContent>
        </Card>
        <section aria-labelledby="my-leave" className="space-y-3">
          <h2 id="my-leave" className="text-base font-semibold">
            Your applications
          </h2>
          <LeaveList schoolSlug={school.slug} rows={myRows} empty="You have not applied for leave." />
        </section>
      </div>

      <section aria-labelledby="decided-leave" className="space-y-3">
        <h2 id="decided-leave" className="text-base font-semibold">
          Recently decided student leave
        </h2>
        <LeaveList schoolSlug={school.slug} rows={decidedRows} showApplicant empty="Nothing decided yet." />
      </section>
    </div>
  );
}
