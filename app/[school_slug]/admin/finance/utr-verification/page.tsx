import type { Metadata } from 'next';
import { requireTenantSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatDateTime, formatINR } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ClaimActions, StatementReconciler, UpiIdForm } from './utr-components';

export const metadata: Metadata = { title: 'UPI verification' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { school_slug: string };
}

/**
 * Accountants' queue for direct UPI payments: families report a UTR, the
 * school finds it on its bank statement and approves it, which issues the
 * receipt. Uploading the statement approves every exact match at once.
 */
export default async function UtrVerificationPage({ params }: PageProps) {
  const { school } = await requireTenantSession(params.school_slug, ['SUPER_ADMIN', 'SCHOOL_ADMIN']);
  const supabase = createClient();

  const [{ data: pendingRows }, { data: recentRows }] = await Promise.all([
    supabase
      .from('upi_payment_claims')
      .select('id, student_id, amount, utr, invoice_ref, created_at')
      .eq('school_id', school.id)
      .eq('status', 'PENDING')
      .order('created_at')
      .limit(500),
    supabase
      .from('upi_payment_claims')
      .select('id, student_id, amount, utr, status, review_note, reviewed_at, payment_id')
      .eq('school_id', school.id)
      .neq('status', 'PENDING')
      .order('reviewed_at', { ascending: false })
      .limit(20),
  ]);
  const pending = pendingRows ?? [];
  const recent = recentRows ?? [];

  const studentIds = [...new Set([...pending, ...recent].map((row) => row.student_id))];
  const { data: studentRows } = studentIds.length
    ? await supabase
        .from('students')
        .select('id, full_name, class_grade, section, current_balance')
        .in('id', studentIds)
    : { data: [] };
  const students = new Map((studentRows ?? []).map((row) => [row.id, row]));
  const pendingTotal = pending.reduce((sum, row) => sum + Number(row.amount), 0);

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">UPI verification</h1>
        <p className="text-sm text-muted-foreground">
          Direct UPI payments carry no gateway fee. Match each reported UTR with your bank statement to issue the
          receipt.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">School UPI ID</CardTitle>
            <CardDescription>
              Shown to families as a QR in the portal and printed on fee invoices. Use the UPI ID of the school&apos;s
              current account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UpiIdForm schoolSlug={school.slug} current={school.upi_vpa ?? ''} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reconcile a bank statement</CardTitle>
            <CardDescription>
              Upload the CSV from net banking (or paste the rows). Claims whose UTR appears with the same amount are
              approved; the rest stay here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StatementReconciler schoolSlug={school.slug} disabled={pending.length === 0} />
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b py-4">
          <CardTitle className="text-base">
            Awaiting verification · {pending.length} {pending.length === 1 ? 'claim' : 'claims'}
            {pending.length > 0 ? ` · ${formatINR(pendingTotal)}` : ''}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {pending.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">Nothing to verify.</p>
          ) : (
            <ul className="divide-y" aria-label="Claims awaiting verification">
              {pending.map((claim) => {
                const student = students.get(claim.student_id);
                return (
                  <li
                    key={claim.id}
                    data-utr={claim.utr}
                    className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_auto] md:items-center"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-semibold">
                        {formatINR(claim.amount, true)} · UTR <span className="font-mono">{claim.utr}</span>
                      </p>
                      <p className="truncate text-sm">
                        {student
                          ? `${student.full_name} · Class ${student.class_grade}-${student.section} · balance ${formatINR(student.current_balance)}`
                          : 'Student'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Reported {formatDateTime(claim.created_at)}
                        {claim.invoice_ref ? ` · note ${claim.invoice_ref}` : ''}
                      </p>
                    </div>
                    <ClaimActions schoolSlug={school.slug} claimId={claim.id} utr={claim.utr} />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {recent.length > 0 ? (
        <Card className="overflow-hidden">
          <CardHeader className="border-b py-4">
            <CardTitle className="text-base">Recently decided</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y" aria-label="Recently decided claims">
              {recent.map((claim) => (
                <li key={claim.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span className="min-w-0">
                    {formatINR(claim.amount, true)} · <span className="font-mono">{claim.utr}</span> ·{' '}
                    {students.get(claim.student_id)?.full_name ?? 'Student'}
                    {claim.review_note ? (
                      <span className="text-muted-foreground"> · {claim.review_note}</span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {claim.payment_id ? (
                      <a
                        href={`/receipts/${claim.payment_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-medium underline-offset-2 hover:underline"
                      >
                        Receipt
                      </a>
                    ) : null}
                    <span
                      className={
                        claim.status === 'APPROVED'
                          ? 'text-xs font-semibold text-emerald-700'
                          : 'text-xs font-semibold text-rose-700'
                      }
                    >
                      {claim.status === 'APPROVED' ? 'Approved' : 'Rejected'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
