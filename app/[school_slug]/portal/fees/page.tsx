import type { Metadata } from 'next';
import { Download, FileText } from 'lucide-react';
import type { FeeStructure, PaymentStatus } from '@/types/database';
import { getPortalContext } from '@/lib/portal';
import { createClient } from '@/lib/supabase/server';
import { PAYMENT_STATUS_STYLES, isSettledPayment, netPaid, paymentStatusLabel } from '@/lib/constants';
import { cn, formatDate, formatINR } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PayButton } from '../_components/pay-button';

export const metadata: Metadata = { title: 'Fees & receipts' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { school_slug: string };
}

const STANDARD_ORDER = ['Tuition', 'Exam', 'Bus'];
const UNCATEGORISED = 'Custom';

export default async function PortalFeesPage({ params }: PageProps) {
  const { active, school, profile } = await getPortalContext(params.school_slug);
  if (!active) return null;

  const supabase = createClient();
  const { data: academicYear } = await supabase.rpc('current_academic_year');

  const [headsResult, typesResult, paymentsResult] = await Promise.all([
    supabase
      .from('fee_structures')
      .select('*')
      .eq('school_id', school.id)
      .eq('class_grade', active.classGrade)
      .eq('academic_year', academicYear ?? '')
      .or(`student_id.is.null,student_id.eq.${active.id}`)
      .order('due_date'),
    supabase.from('fee_types').select('id, name').eq('school_id', school.id),
    supabase
      .from('fee_payments')
      .select('id, amount_paid, amount_refunded, status, payment_method, receipt_number, paid_at, created_at')
      .eq('student_id', active.id)
      .neq('status', 'PENDING')
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  const typeNames = new Map((typesResult.data ?? []).map((type) => [type.id, type.name]));
  const heads: FeeStructure[] = headsResult.data ?? [];
  const groups = new Map<string, FeeStructure[]>();
  for (const head of heads) {
    const name = (head.fee_type_id && typeNames.get(head.fee_type_id)) || UNCATEGORISED;
    groups.set(name, [...(groups.get(name) ?? []), head]);
  }
  const order = (name: string) => {
    const index = STANDARD_ORDER.indexOf(name);
    if (index !== -1) return index;
    return name === UNCATEGORISED ? 99 : 50;
  };
  const groupNames = [...groups.keys()].sort((a, b) => order(a) - order(b) || a.localeCompare(b));

  const payments = (paymentsResult.data ?? []) as {
    id: string;
    amount_paid: number;
    amount_refunded: number;
    status: PaymentStatus;
    payment_method: string;
    receipt_number: string | null;
    paid_at: string | null;
    created_at: string;
  }[];
  const paid = payments.reduce((sum, payment) => sum + netPaid(payment), 0);
  const balance = active.currentBalance;
  const assessed = heads.reduce((sum, head) => sum + Number(head.amount), 0);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Fees &amp; payments</h1>
        <p className="text-sm text-muted-foreground">
          {active.fullName} · Class {active.classGrade}-{active.section} · {academicYear ?? 'current year'}
        </p>
      </header>

      <Card>
        <CardContent className="grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-center">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Fees for the year</dt>
              <dd className="text-lg font-semibold">{formatINR(assessed)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Concession</dt>
              <dd className="text-lg font-semibold text-emerald-700">
                {active.feeConcession > 0 ? `- ${formatINR(active.feeConcession)}` : '-'}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Paid</dt>
              <dd className="text-lg font-semibold">{formatINR(paid)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Balance due</dt>
              <dd className={cn('text-lg font-bold', balance > 0 ? 'text-amber-700' : 'text-emerald-700')}>
                {formatINR(balance)}
              </dd>
            </div>
          </dl>
          {balance > 0 ? (
            <PayButton
              studentId={active.id}
              studentName={active.fullName}
              amount={balance}
              schoolName={school.name}
              prefill={{ name: profile.full_name, email: profile.email, contact: profile.phone }}
            />
          ) : (
            <Badge variant="secondary" className="justify-self-start">
              Fully paid
            </Badge>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b py-4">
            <CardTitle className="text-base">Fee ledger</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {groupNames.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                The school has not published fees for this class yet.
              </p>
            ) : (
              groupNames.map((name) => {
                const list = groups.get(name) ?? [];
                return (
                  <section key={name} aria-label={`${name} fees`}>
                    <div className="flex items-center justify-between bg-muted/40 px-5 py-2 text-sm font-semibold">
                      <span>{name}</span>
                      <span>{formatINR(list.reduce((sum, head) => sum + Number(head.amount), 0))}</span>
                    </div>
                    <ul className="divide-y">
                      {list.map((head) => (
                        <li key={head.id} className="flex items-center justify-between gap-3 px-5 py-3">
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <p className="truncate text-sm font-medium">{head.title}</p>
                              {head.student_id ? (
                                <Badge variant="outline" className="shrink-0 text-[10px]">
                                  Individual
                                </Badge>
                              ) : null}
                            </div>
                            <p className="text-xs text-muted-foreground">Due {formatDate(head.due_date)}</p>
                          </div>
                          <p className="whitespace-nowrap text-sm font-semibold">{formatINR(head.amount)}</p>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="border-b py-4">
            <CardTitle className="text-base">Payments &amp; receipts</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {payments.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">No payments yet.</p>
            ) : (
              <ul className="divide-y">
                {payments.map((payment) => (
                  <li key={payment.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{formatINR(payment.amount_paid, true)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatDate(payment.paid_at ?? payment.created_at)} · {payment.payment_method}
                      </p>
                      {Number(payment.amount_refunded) > 0 ? (
                        <p className="text-xs font-medium text-violet-700 dark:text-violet-300">
                          {formatINR(payment.amount_refunded, true)} refunded to your account
                        </p>
                      ) : null}
                    </div>
                    {isSettledPayment(payment.status) ? (
                      <div className="flex shrink-0 gap-1">
                        <a
                          href={`/receipts/${payment.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent"
                        >
                          <FileText className="h-3.5 w-3.5" aria-hidden />
                          Receipt
                        </a>
                        <a
                          href={`/receipts/${payment.id}`}
                          download
                          aria-label={`Download receipt ${payment.receipt_number ?? ''}`}
                          className="inline-flex items-center rounded-md border px-2 py-1 hover:bg-accent"
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden />
                        </a>
                      </div>
                    ) : (
                      <span
                        className={cn(
                          'shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold',
                          PAYMENT_STATUS_STYLES[payment.status],
                        )}
                      >
                        {paymentStatusLabel(payment.status)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
