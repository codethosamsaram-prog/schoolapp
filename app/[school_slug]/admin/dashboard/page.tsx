import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowUpRight,
  CalendarCheck,
  IndianRupee,
  UserPlus,
  Wallet,
} from 'lucide-react';
import type { AdmissionLead, DashboardMetrics, PaymentStatus } from '@/types/database';
import { requireTenantSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { cn, formatDate, formatDateTime, formatINR, todayInIST } from '@/lib/utils';
import { PAYMENT_STATUS_STYLES, paymentStatusLabel } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { KpiCard } from './_components/kpi-card';
import { LeadsTable } from './_components/leads-table';

export const metadata: Metadata = { title: 'Dashboard' };

// Operational numbers; always rendered fresh for the signed-in administrator.
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { school_slug: string };
}

const EMPTY_METRICS: DashboardMetrics = {
  revenue_collected: 0,
  outstanding_balance: 0,
  students_total: 0,
  attendance_present: 0,
  attendance_marked: 0,
  attendance_percent: 0,
  leads_new: 0,
  leads_total: 0,
};

interface RecentPayment {
  id: string;
  amount_paid: number;
  status: PaymentStatus;
  payment_method: string;
  receipt_number: string | null;
  created_at: string;
  students: { full_name: string; class_grade: string; section: string } | null;
}

export default async function AdminDashboardPage({ params }: PageProps) {
  const { school } = await requireTenantSession(params.school_slug, [
    'SUPER_ADMIN',
    'SCHOOL_ADMIN',
  ]);

  const supabase = createClient();
  const today = todayInIST();

  // One round trip for the aggregates, one for each list the page renders.
  const [metricsResult, leadsResult, paymentsResult] = await Promise.all([
    supabase.rpc('school_dashboard_metrics', { target_school: school.id, target_date: today }),
    supabase
      .from('admission_leads')
      .select('*')
      .eq('school_id', school.id)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('fee_payments')
      .select('id, amount_paid, status, payment_method, receipt_number, created_at, students(full_name, class_grade, section)')
      .eq('school_id', school.id)
      .order('created_at', { ascending: false })
      .limit(6),
  ]);

  if (metricsResult.error) {
    console.error('[dashboard] metrics rpc failed', { error: metricsResult.error.message });
  }
  if (leadsResult.error) {
    console.error('[dashboard] leads query failed', { error: leadsResult.error.message });
  }
  if (paymentsResult.error) {
    console.error('[dashboard] payments query failed', { error: paymentsResult.error.message });
  }

  const metrics: DashboardMetrics = metricsResult.data?.[0] ?? EMPTY_METRICS;
  const leads: AdmissionLead[] = leadsResult.data ?? [];
  const payments = (paymentsResult.data ?? []) as unknown as RecentPayment[];

  const attendanceHint =
    metrics.attendance_marked === 0
      ? 'Attendance not marked yet today'
      : `${metrics.attendance_present} present of ${metrics.attendance_marked} marked`;

  const collectionRate =
    Number(metrics.revenue_collected) + Number(metrics.outstanding_balance) > 0
      ? (Number(metrics.revenue_collected) /
          (Number(metrics.revenue_collected) + Number(metrics.outstanding_balance))) *
        100
      : 0;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 lg:px-8 lg:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">Overview</h1>
          <p className="text-sm text-muted-foreground">
            {school.name} &middot; {formatDate(today, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/${school.slug}`} target="_blank" rel="noreferrer">
            View public portal
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Revenue collected"
          value={formatINR(metrics.revenue_collected)}
          hint={`${collectionRate.toFixed(1)}% of assessed fees`}
          icon={IndianRupee}
          tone="success"
        />
        <KpiCard
          label="Outstanding balance"
          value={formatINR(metrics.outstanding_balance)}
          hint={`Across ${metrics.students_total} active students`}
          icon={Wallet}
          tone={Number(metrics.outstanding_balance) > 0 ? 'warning' : 'default'}
        />
        <KpiCard
          label="Attendance today"
          value={`${Number(metrics.attendance_percent).toFixed(1)}%`}
          hint={attendanceHint}
          icon={CalendarCheck}
          tone={Number(metrics.attendance_percent) >= 85 ? 'success' : 'warning'}
        />
        <KpiCard
          label="New admission leads"
          value={String(metrics.leads_new)}
          hint={`${metrics.leads_total} enquiries in total`}
          icon={UserPlus}
          tone={Number(metrics.leads_new) > 0 ? 'default' : 'default'}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between space-y-0 border-b py-4">
            <div>
              <CardTitle className="text-base">Recent admission leads</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Update a status to move an enquiry through the pipeline.
              </p>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/${school.slug}/admin/admissions`}>View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <LeadsTable schoolSlug={school.slug} leads={leads} />
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="border-b py-4">
            <CardTitle className="text-base">Recent fee payments</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Settled through Razorpay and reconciled by webhook.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {payments.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                No payments recorded yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell>
                        <div className="font-medium">
                          {payment.students?.full_name ?? 'Unknown student'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {payment.students
                            ? `Class ${payment.students.class_grade}-${payment.students.section} · `
                            : ''}
                          {formatDateTime(payment.created_at)}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold">
                        {formatINR(payment.amount_paid, true)}
                        <div className="text-xs font-normal text-muted-foreground">
                          {payment.payment_method}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={cn(
                            'inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold',
                            PAYMENT_STATUS_STYLES[payment.status],
                          )}
                        >
                          {paymentStatusLabel(payment.status)}
                        </span>
                        {payment.receipt_number ? (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {payment.receipt_number}
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="space-y-1 p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Active students</p>
            <p className="text-xl font-semibold">{metrics.students_total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Marked today</p>
            <p className="text-xl font-semibold">
              {metrics.attendance_marked}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                of {metrics.students_total}
              </span>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Pipeline</p>
            <div className="flex flex-wrap gap-1 pt-1">
              <Badge variant="secondary">{metrics.leads_new} new</Badge>
              <Badge variant="outline">{metrics.leads_total} total</Badge>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
