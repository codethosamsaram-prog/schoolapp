import type { Metadata } from 'next';
import Link from 'next/link';
import type { AdmissionLead, LeadStatus } from '@/types/database';
import { requireTenantSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { LEAD_STATUSES, LEAD_STATUS_LABELS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LeadsTable } from '../dashboard/_components/leads-table';

export const metadata: Metadata = { title: 'Admissions' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { school_slug: string };
  searchParams: { status?: string };
}

function isLeadStatus(value: string | undefined): value is LeadStatus {
  return LEAD_STATUSES.includes(value as LeadStatus);
}

export default async function AdmissionsPage({ params, searchParams }: PageProps) {
  const { school } = await requireTenantSession(params.school_slug, [
    'SUPER_ADMIN',
    'SCHOOL_ADMIN',
  ]);

  const supabase = createClient();
  const status = isLeadStatus(searchParams.status) ? searchParams.status : null;

  // Counts come from the full pipeline; the table only from the active tab.
  const { data, error } = await supabase
    .from('admission_leads')
    .select('*')
    .eq('school_id', school.id)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    console.error('[admissions] leads query failed', { error: error.message });
  }

  const allLeads: AdmissionLead[] = data ?? [];
  const counts = Object.fromEntries(
    LEAD_STATUSES.map((value) => [value, allLeads.filter((lead) => lead.status === value).length]),
  ) as Record<LeadStatus, number>;
  const leads = status ? allLeads.filter((lead) => lead.status === status) : allLeads;

  const tabs: { value: LeadStatus | null; label: string; count: number }[] = [
    { value: null, label: 'All', count: allLeads.length },
    ...LEAD_STATUSES.map((value) => ({
      value,
      label: LEAD_STATUS_LABELS[value],
      count: counts[value],
    })),
  ];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 lg:px-8 lg:py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">Admissions</h1>
        <p className="text-sm text-muted-foreground">
          Every enquiry from your public portal. Call the parent, then move the lead along.
        </p>
      </header>

      <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Filter by status">
        {tabs.map((tab) => {
          const active = tab.value === status;
          return (
            <Link
              key={tab.label}
              href={
                tab.value
                  ? `/${school.slug}/admin/admissions?status=${tab.value}`
                  : `/${school.slug}/admin/admissions`
              }
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
              <span
                className={cn(
                  'rounded-full px-1.5 text-xs',
                  active ? 'bg-primary-foreground/20' : 'bg-muted',
                )}
              >
                {tab.count}
              </span>
            </Link>
          );
        })}
      </nav>

      <Card className="overflow-hidden">
        <CardHeader className="border-b py-4">
          <CardTitle className="text-base">
            {status ? `${LEAD_STATUS_LABELS[status]} enquiries` : 'All enquiries'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <LeadsTable schoolSlug={school.slug} leads={leads} />
        </CardContent>
      </Card>
    </div>
  );
}
