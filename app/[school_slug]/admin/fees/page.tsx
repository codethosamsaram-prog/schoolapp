import type { Metadata } from 'next';
import Link from 'next/link';
import type { FeeStructure, PaymentStatus } from '@/types/database';
import { requireTenantSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import {
  CLASS_GRADES,
  PAYMENT_STATUS_STYLES,
  REMINDER_COOLDOWN_DAYS,
  netPaid,
  paymentStatusLabel,
} from '@/lib/constants';
import { getWhatsAppHealth } from '@/lib/whatsapp-health';
import { cn, formatDate, formatDateTime, formatINR } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { FeeHeadForm, FeeTypeManager } from './_components/fee-head-form';
import { DeleteFeeHeadButton } from './_components/delete-fee-head-button';
import { FeeRemindersDialog, type OwingClass } from './_components/fee-reminders-dialog';
import { PaymentActions } from './_components/payment-actions';
import { WhatsAppHealthBanner } from './_components/whatsapp-health-banner';

export const metadata: Metadata = { title: 'Fees' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { school_slug: string };
  searchParams: { status?: string; whatsapp?: string };
}

const PAYMENT_STATUSES: PaymentStatus[] = [
  'SUCCESS',
  'PENDING',
  'FAILED',
  'VOIDED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
];

interface LedgerRow {
  id: string;
  amount_paid: number;
  status: PaymentStatus;
  payment_method: string;
  receipt_number: string | null;
  razorpay_payment_id: string | null;
  void_reason: string | null;
  amount_refunded: number;
  paid_at: string | null;
  created_at: string;
  students: { full_name: string; class_grade: string; section: string } | null;
  fee_structures: { title: string } | null;
}

function gradeRank(grade: string): number {
  const index = (CLASS_GRADES as readonly string[]).indexOf(grade);
  return index === -1 ? CLASS_GRADES.length : index;
}

export default async function FeesPage({ params, searchParams }: PageProps) {
  const { school } = await requireTenantSession(params.school_slug, [
    'SUPER_ADMIN',
    'SCHOOL_ADMIN',
  ]);

  const supabase = createClient();
  const status = PAYMENT_STATUSES.includes(searchParams.status as PaymentStatus)
    ? (searchParams.status as PaymentStatus)
    : null;

  const { data: academicYear } = await supabase.rpc('current_academic_year');

  let ledgerRequest = supabase
    .from('fee_payments')
    .select(
      'id, amount_paid, status, payment_method, receipt_number, razorpay_payment_id, void_reason, amount_refunded, paid_at, created_at, students(full_name, class_grade, section), fee_structures(title)',
    )
    .eq('school_id', school.id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (status) ledgerRequest = ledgerRequest.eq('status', status);

  const [headsResult, ledgerResult, typesResult, studentsResult, owingResult] = await Promise.all([
    supabase
      .from('fee_structures')
      .select('*')
      .eq('school_id', school.id)
      .eq('academic_year', academicYear ?? '')
      // Monthly transport charges are managed on the Transport page.
      .is('transport_month', null)
      .order('due_date'),
    ledgerRequest,
    supabase
      .from('fee_types')
      .select('id, name, is_system')
      .eq('school_id', school.id)
      .order('name'),
    supabase
      .from('students')
      .select('id, full_name, roll_number, class_grade, section')
      .eq('school_id', school.id)
      .eq('is_active', true)
      .order('full_name'),
    supabase
      .from('students')
      .select('class_grade, current_balance, last_fee_reminder_at')
      .eq('school_id', school.id)
      .eq('is_active', true)
      .gt('current_balance', 0)
      .limit(5000),
  ]);

  const reminderCutoff = Date.now() - REMINDER_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  const owingByClass = new Map<string, OwingClass>();
  for (const row of owingResult.data ?? []) {
    const entry = owingByClass.get(row.class_grade) ?? {
      classGrade: row.class_grade,
      students: 0,
      due: 0,
      amount: 0,
    };
    entry.students += 1;
    entry.amount += Number(row.current_balance);
    if (!row.last_fee_reminder_at || Date.parse(row.last_fee_reminder_at) < reminderCutoff) {
      entry.due += 1;
    }
    owingByClass.set(row.class_grade, entry);
  }
  const owingClasses = [...owingByClass.values()].sort(
    (a, b) => gradeRank(a.classGrade) - gradeRank(b.classGrade),
  );

  const feeTypes = (typesResult.data ?? [])
    .map((type) => ({ id: type.id, name: type.name, isSystem: type.is_system }))
    .sort((a, b) => Number(b.isSystem) - Number(a.isSystem) || a.name.localeCompare(b.name));
  const typeNames = new Map(feeTypes.map((type) => [type.id, type.name]));
  const studentNames = new Map(
    (studentsResult.data ?? []).map((student) => [
      student.id,
      `${student.full_name} (${student.class_grade}-${student.section})`,
    ]),
  );

  if (headsResult.error) {
    console.error('[fees] fee structures query failed', { error: headsResult.error.message });
  }
  if (ledgerResult.error) {
    console.error('[fees] ledger query failed', { error: ledgerResult.error.message });
  }

  const heads: FeeStructure[] = headsResult.data ?? [];
  const ledger = (ledgerResult.data ?? []) as unknown as LedgerRow[];

  const byClass = new Map<string, FeeStructure[]>();
  for (const head of heads) {
    const list = byClass.get(head.class_grade) ?? [];
    list.push(head);
    byClass.set(head.class_grade, list);
  }
  const classes = [...byClass.keys()].sort((a, b) => gradeRank(a) - gradeRank(b));

  const collected = ledger.reduce((sum, row) => sum + netPaid(row), 0);

  const health = await getWhatsAppHealth({ fresh: searchParams.whatsapp === 'recheck' });
  const recheckQuery = new URLSearchParams({
    ...(status ? { status } : {}),
    whatsapp: 'recheck',
  });

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 lg:px-8 lg:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl space-y-1">
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">Fees</h1>
          <p className="text-sm text-muted-foreground">
            Fee schedule for {academicYear ?? 'the current academic year'}. Each class&apos;s dues
            are the sum of its fee heads, and changes apply to every active student in that class.
          </p>
        </div>
        <FeeRemindersDialog
          schoolSlug={school.slug}
          classes={owingClasses}
          cooldownDays={REMINDER_COOLDOWN_DAYS}
          whatsappReady={health.remindersReady}
        />
      </header>

      <WhatsAppHealthBanner
        health={health}
        recheckHref={`/${school.slug}/admin/fees?${recheckQuery.toString()}`}
      />

      <section className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b py-4">
            <CardTitle className="text-base">Fee schedule</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {classes.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                No fee heads for this academic year yet. Add one to publish it on your portal.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fee head</TableHead>
                    <TableHead className="hidden sm:table-cell">Due</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">Remove</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {classes.map((grade) => {
                    const list = byClass.get(grade) ?? [];
                    // The class total is what every student owes; individual charges sit on top.
                    const total = list
                      .filter((head) => !head.student_id)
                      .reduce((sum, head) => sum + Number(head.amount), 0);
                    return [
                      <TableRow key={`${grade}-heading`} className="bg-muted/40 hover:bg-muted/40">
                        <TableCell colSpan={2} className="py-2 text-sm font-semibold">
                          Class {grade}
                        </TableCell>
                        <TableCell className="py-2 text-right text-sm font-semibold">
                          {formatINR(total)}
                        </TableCell>
                        <TableCell className="py-2" />
                      </TableRow>,
                      ...list.map((head) => (
                        <TableRow key={head.id}>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-1.5 font-medium">
                              {head.title}
                              <Badge variant="outline" className="text-[10px] font-normal">
                                {(head.fee_type_id && typeNames.get(head.fee_type_id)) || 'Custom'}
                              </Badge>
                              {head.student_id ? (
                                <Badge variant="secondary" className="text-[10px] font-normal">
                                  Only {studentNames.get(head.student_id) ?? 'one student'}
                                </Badge>
                              ) : null}
                            </div>
                            {head.description ? (
                              <div className="text-xs text-muted-foreground">
                                {head.description}
                              </div>
                            ) : null}
                            <div className="text-xs text-muted-foreground sm:hidden">
                              Due {formatDate(head.due_date)}
                            </div>
                          </TableCell>
                          <TableCell className="hidden whitespace-nowrap text-sm sm:table-cell">
                            {formatDate(head.due_date)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right">
                            {formatINR(head.amount)}
                          </TableCell>
                          <TableCell className="text-right">
                            <DeleteFeeHeadButton
                              schoolSlug={school.slug}
                              feeStructureId={head.id}
                              title={`${head.title} (Class ${head.class_grade})`}
                            />
                          </TableCell>
                        </TableRow>
                      )),
                    ];
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader className="border-b py-4">
            <CardTitle className="text-base">Add or update a fee head</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Saving an existing title for the same class updates it. Monthly bus fees are added
              from the Transport page.
            </p>
          </CardHeader>
          <CardContent className="pt-5">
            <FeeHeadForm
              schoolSlug={school.slug}
              feeTypes={feeTypes}
              students={(studentsResult.data ?? []).map((student) => ({
                id: student.id,
                classGrade: student.class_grade,
                label: `${student.full_name} · ${student.section} · Roll ${student.roll_number}`,
              }))}
            />
          </CardContent>
          <CardHeader className="border-t py-4">
            <CardTitle className="text-base">Fee categories</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Group fee heads on the parent ledger. Tuition, Exam and Bus are built in.
            </p>
          </CardHeader>
          <CardContent>
            <FeeTypeManager schoolSlug={school.slug} feeTypes={feeTypes} />
          </CardContent>
        </Card>
      </section>

      <Card className="overflow-hidden">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0 border-b py-4">
          <div>
            <CardTitle className="text-base">Payments</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Latest 100 &middot; {formatINR(collected)} settled in this view
            </p>
          </div>
          <nav className="flex flex-wrap gap-1" aria-label="Filter payments">
            {[null, ...PAYMENT_STATUSES].map((value) => (
              <Link
                key={value ?? 'ALL'}
                href={
                  value
                    ? `/${school.slug}/admin/fees?status=${value}`
                    : `/${school.slug}/admin/fees`
                }
                aria-current={value === status ? 'page' : undefined}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium',
                  value === status
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {value
                  ? paymentStatusLabel(value).charAt(0) + paymentStatusLabel(value).slice(1).toLowerCase()
                  : 'All'}
              </Link>
            ))}
          </nav>
        </CardHeader>
        <CardContent className="p-0">
          {ledger.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              No payments {status ? `with status ${status.toLowerCase()}` : 'recorded yet'}.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead className="hidden md:table-cell">For</TableHead>
                  <TableHead className="hidden lg:table-cell">Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-medium">
                        {row.students?.full_name ?? 'Unknown student'}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {row.students
                          ? `Class ${row.students.class_grade}-${row.students.section}`
                          : ''}
                        <span className="lg:hidden">
                          {' '}
                          · {formatDate(row.paid_at ?? row.created_at)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">
                      {row.fee_structures?.title ?? 'Outstanding balance'}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground lg:table-cell">
                      {formatDateTime(row.paid_at ?? row.created_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <div className="font-semibold">{formatINR(row.amount_paid, true)}</div>
                      <div className="text-xs text-muted-foreground">{row.payment_method}</div>
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={cn(
                          'inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold',
                          PAYMENT_STATUS_STYLES[row.status],
                        )}
                      >
                        {paymentStatusLabel(row.status)}
                      </span>
                      {Number(row.amount_refunded) > 0 ? (
                        <div className="mt-1 whitespace-nowrap text-[11px] font-medium text-violet-700 dark:text-violet-300">
                          {formatINR(row.amount_refunded, true)} refunded
                        </div>
                      ) : null}
                      {row.receipt_number ? (
                        <div
                          className="mt-1 max-w-[12rem] text-[11px] text-muted-foreground sm:ml-auto"
                          title={row.void_reason ?? undefined}
                        >
                          {row.receipt_number}
                          {row.status === 'VOIDED' && row.void_reason ? ` · ${row.void_reason}` : ''}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <PaymentActions
                        schoolSlug={school.slug}
                        paymentId={row.id}
                        status={row.status}
                        online={Boolean(row.razorpay_payment_id)}
                        amountPaid={Number(row.amount_paid)}
                        amountRefunded={Number(row.amount_refunded)}
                        studentName={row.students?.full_name ?? 'this student'}
                        receiptNumber={row.receipt_number}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
