import { NextResponse, type NextRequest } from 'next/server';
import { renderToStream } from '@react-pdf/renderer';
import { createClient } from '@/lib/supabase/server';
import { PAYROLL_METHOD_LABELS, STAFF_ROLE_LABELS } from '@/lib/constants';
import { periodLabel } from '@/lib/payroll';
import { formatDate } from '@/lib/utils';
import { PayslipPDF } from '@/components/pdf/PayslipPDF';

/**
 * Streams one payslip. Reads run on the caller's session, and payslip RLS
 * admits school admins only, so anyone else gets a 404.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams {
  params: { payslip_id: string };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!UUID_PATTERN.test(params.payslip_id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const supabase = createClient();
  const { data: slip } = await supabase
    .from('payslips')
    .select('*')
    .eq('id', params.payslip_id)
    .maybeSingle();
  if (!slip) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [{ data: staff }, { data: school }] = await Promise.all([
    supabase
      .from('staff')
      .select('full_name, employee_code, staff_role, departments, date_of_joining, bank_name, bank_account_last4')
      .eq('id', slip.staff_id)
      .maybeSingle(),
    supabase
      .from('schools')
      .select('name, address, city, state, pincode, primary_color')
      .eq('id', slip.school_id)
      .maybeSingle(),
  ]);
  if (!staff || !school) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const stream = await renderToStream(
    <PayslipPDF
      school={{
        name: school.name,
        addressLine:
          [school.address, school.city, school.state, school.pincode].filter(Boolean).join(', ') || null,
      }}
      staff={{
        fullName: staff.full_name,
        employeeCode: staff.employee_code,
        role: STAFF_ROLE_LABELS[staff.staff_role],
        departments: staff.departments,
        dateOfJoining: staff.date_of_joining ? formatDate(staff.date_of_joining) : null,
        bank: staff.bank_account_last4
          ? `${staff.bank_name ?? 'Account'} ending ${staff.bank_account_last4}`
          : null,
      }}
      slip={{
        slipNumber: slip.slip_number,
        periodLabel: periodLabel(slip.period),
        basePay: Number(slip.base_pay),
        additions: slip.additions.map((line) => ({ label: line.label, amount: Number(line.amount) })),
        deductions: slip.deductions.map((line) => ({ label: line.label, amount: Number(line.amount) })),
        grossPay: Number(slip.gross_pay),
        totalDeductions: Number(slip.total_deductions),
        netPay: Number(slip.net_pay),
        paymentMethod: PAYROLL_METHOD_LABELS[slip.payment_method].toLowerCase(),
        paymentReference: slip.payment_reference,
        paidOn: formatDate(slip.paid_at),
      }}
      accentColor={school.primary_color ?? '#1d4ed8'}
    />,
  );

  const download = request.nextUrl.searchParams.get('download') === '1';
  return new NextResponse(stream as unknown as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${slip.slip_number}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
