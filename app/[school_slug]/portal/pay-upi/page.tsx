import type { Metadata } from 'next';
import { FileText } from 'lucide-react';
import type { UpiClaimStatus } from '@/types/database';
import { getPortalContext } from '@/lib/portal';
import { createClient } from '@/lib/supabase/server';
import { invoiceRef } from '@/lib/upi';
import { cn, formatDate, formatINR } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UpiPayPanel } from './upi-pay-panel';

export const metadata: Metadata = { title: 'Pay by UPI' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { school_slug: string };
}

const STATUS_STYLES: Record<UpiClaimStatus, string> = {
  PENDING: 'border-amber-200 bg-amber-50 text-amber-900',
  APPROVED: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  REJECTED: 'border-rose-200 bg-rose-50 text-rose-800',
};

const STATUS_LABELS: Record<UpiClaimStatus, string> = {
  PENDING: 'Awaiting verification',
  APPROVED: 'Verified',
  REJECTED: 'Not verified',
};

/**
 * Pays fees straight to the school's UPI ID: no gateway charges for the
 * school, nothing extra for the family. The receipt follows once the school
 * finds the UTR on its bank statement.
 */
export default async function PayUpiPage({ params }: PageProps) {
  const { active, school } = await getPortalContext(params.school_slug);
  if (!active) return null;

  const supabase = createClient();
  const [{ data: academicYear }, { data: claimRows }] = await Promise.all([
    supabase.rpc('current_academic_year'),
    supabase
      .from('upi_payment_claims')
      .select('id, amount, utr, status, review_note, payment_id, created_at')
      .eq('student_id', active.id)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);
  const claims = claimRows ?? [];
  const awaiting = claims
    .filter((claim) => claim.status === 'PENDING')
    .reduce((sum, claim) => sum + Number(claim.amount), 0);
  const claimable = Math.max(active.currentBalance - awaiting, 0);
  const reference = invoiceRef(active, academicYear ?? '');

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Pay by UPI</h1>
          <p className="text-sm text-muted-foreground">
            {active.fullName} · Balance due {formatINR(active.currentBalance)}
            {awaiting > 0 ? ` · ${formatINR(awaiting)} awaiting verification` : ''}
          </p>
        </div>
        <a
          href={`/invoices/${active.id}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
        >
          <FileText className="h-4 w-4" aria-hidden />
          Fee invoice (PDF)
        </a>
      </header>

      <Card>
        <CardContent className="p-5">
          {!school.upi_vpa ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              The school has not set up direct UPI payments yet. You can pay online from Fees &amp; receipts.
            </p>
          ) : claimable <= 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {active.currentBalance > 0
                ? 'Everything outstanding is already awaiting verification.'
                : 'Nothing is due right now.'}
            </p>
          ) : (
            <UpiPayPanel
              studentId={active.id}
              vpa={school.upi_vpa}
              payeeName={school.name}
              invoiceRef={reference}
              claimable={claimable}
            />
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="border-b py-4">
          <CardTitle className="text-base">Reported UPI payments</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {claims.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">None yet.</p>
          ) : (
            <ul className="divide-y" aria-label="Reported UPI payments">
              {claims.map((claim) => (
                <li key={claim.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{formatINR(claim.amount, true)}</p>
                    <p className="text-xs text-muted-foreground">
                      UTR <span className="font-mono">{claim.utr}</span> · {formatDate(claim.created_at)}
                    </p>
                    {claim.review_note ? (
                      <p className="break-words text-xs text-muted-foreground">School: {claim.review_note}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {claim.payment_id ? (
                      <a
                        href={`/receipts/${claim.payment_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent"
                      >
                        <FileText className="h-3.5 w-3.5" aria-hidden />
                        Receipt
                      </a>
                    ) : null}
                    <Badge variant="outline" className={cn('text-xs', STATUS_STYLES[claim.status])}>
                      {STATUS_LABELS[claim.status]}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
