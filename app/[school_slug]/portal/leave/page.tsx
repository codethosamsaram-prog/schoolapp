import type { Metadata } from 'next';
import { getPortalContext } from '@/lib/portal';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LeaveForm, LeaveList } from '../../_leave/leave-components';
import { LEAVE_SELECT, toLeaveRows } from '../../_leave/rows';

export const metadata: Metadata = { title: 'Leave' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { school_slug: string };
}

export default async function PortalLeavePage({ params }: PageProps) {
  const { active, school, userId, profile } = await getPortalContext(params.school_slug);
  if (!active) return null;

  const supabase = createClient();
  const { data } = await supabase
    .from('leave_requests')
    .select(LEAVE_SELECT)
    .eq('student_id', active.id)
    .order('start_date', { ascending: false })
    .limit(50);
  const rows = await toLeaveRows(supabase, data, { userId, role: profile.role });

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Leave</h1>
        <p className="text-sm text-muted-foreground">
          Apply for leave for {active.fullName}. Once the school approves it, those days show as on leave
          in attendance instead of absent.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <Card className="h-fit">
          <CardHeader className="border-b py-4">
            <CardTitle className="text-base">Apply for leave</CardTitle>
          </CardHeader>
          <CardContent className="pt-5">
            <LeaveForm
              schoolSlug={school.slug}
              studentId={active.id}
              applicantLabel={`${active.fullName}, Class ${active.classGrade}-${active.section}`}
            />
          </CardContent>
        </Card>

        <section aria-labelledby="leave-history" className="space-y-3">
          <h2 id="leave-history" className="text-base font-semibold">
            Applications
          </h2>
          <LeaveList schoolSlug={school.slug} rows={rows} empty="No leave applications yet." />
        </section>
      </div>
    </div>
  );
}
