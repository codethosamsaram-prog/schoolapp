import { expect, test, type Page } from '@playwright/test';
import { TENANT_A, USERS } from './constants';
import { eventually, fixtures, formatINR, serviceDb, signIn, userDb } from './support';
import { currentPayMonth, periodDate, periodLabel, slipNumber } from '../lib/payroll';

/**
 * Staff directory and monthly payroll. The steps build on each other (add
 * staff, pay one person, refuse a repeat, pay everyone else), so they run in
 * order within one describe block.
 */

const MONTH = currentPayMonth();
const PERIOD = periodDate(MONTH);
const STAFF_PAGE = `/${TENANT_A.slug}/admin/staff`;

async function payslipsThisMonth() {
  const { data } = await serviceDb()
    .from('payslips')
    .select('id, staff_id, slip_number, gross_pay, total_deductions, net_pay, payment_method, payment_reference')
    .eq('school_id', TENANT_A.id)
    .eq('period', PERIOD);
  return (data ?? []).map((slip) => ({
    ...slip,
    gross_pay: Number(slip.gross_pay),
    total_deductions: Number(slip.total_deductions),
    net_pay: Number(slip.net_pay),
  }));
}

function tile(page: Page, label: string) {
  return page
    .locator('dl[aria-label="Payroll totals"] > div')
    .filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) })
    .locator('dd')
    .first();
}

function staffRow(page: Page, name: string) {
  return page.getByRole('row').filter({ hasText: name });
}

test.describe('staff and payroll', () => {
  test.describe.configure({ mode: 'serial' });

  test('an admin adds a staff member with a role and departments', async ({ page }) => {
    await signIn(page, 'adminA');
    await page.goto(STAFF_PAGE);

    await page.getByRole('button', { name: 'Add staff' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Full name').fill('E2E Transport Supervisor');
    await dialog.getByLabel('Employee code').fill('e2e-s1');
    await dialog.getByLabel('Role').selectOption('SUPERVISOR');
    await dialog.getByLabel('Monthly base salary (₹)').fill('30000');
    await dialog.getByLabel('Departments').fill('Transport, Discipline, Transport');
    await dialog.getByRole('button', { name: 'Add staff member' }).click();
    await expect(page.getByText('E2E Transport Supervisor added').first()).toBeVisible();

    const { data: saved } = await serviceDb()
      .from('staff')
      .select('employee_code, staff_role, departments, base_salary, is_active')
      .eq('school_id', TENANT_A.id)
      .eq('employee_code', 'E2E-S1')
      .single();
    expect(saved).toMatchObject({
      employee_code: 'E2E-S1',
      staff_role: 'SUPERVISOR',
      departments: ['Transport', 'Discipline'],
      is_active: true,
    });
    expect(Number(saved!.base_salary)).toBe(30000);

    const row = staffRow(page, 'E2E Transport Supervisor');
    await expect(row).toContainText('Supervisor');
    await expect(row).toContainText('Discipline');
    await expect(row).toContainText('Not paid');

    // The employee code is unique within the school.
    await page.getByRole('button', { name: 'Add staff' }).click();
    const again = page.getByRole('dialog');
    await again.getByLabel('Full name').fill('E2E Duplicate');
    await again.getByLabel('Employee code').fill('E2E-S1');
    await again.getByLabel('Role').selectOption('TEACHER');
    await again.getByLabel('Monthly base salary (₹)').fill('1000');
    await again.getByRole('button', { name: 'Add staff member' }).click();
    await expect(again.getByText('Already in use')).toBeVisible();
  });

  test('processing a salary issues a payslip, updates the ledger, and downloads', async ({ page }) => {
    const { staff } = fixtures();
    await signIn(page, 'adminA');
    await page.goto(STAFF_PAGE);

    await page.getByRole('button', { name: 'Actions for E2E Payroll Teacher' }).click();
    await page.getByRole('menuitem', { name: 'Process salary' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading')).toContainText(periodLabel(PERIOD));

    await dialog.getByRole('button', { name: 'Add addition' }).click();
    await dialog.getByLabel('Additions 1 name').fill('Exam duty allowance');
    await dialog.getByLabel('Additions 1 amount').fill('1500');
    await dialog.getByRole('button', { name: '+ Provident fund (12%)' }).click();
    await dialog.getByRole('button', { name: '+ Professional tax' }).click();

    // 45,000 + 1,500 - (5,400 + 200)
    await expect(dialog.getByTestId('net-pay')).toHaveText(formatINR(40900, true));

    await dialog.getByLabel('UTR / reference').fill('UTR-E2E-0001');
    await dialog.getByRole('button', { name: 'Pay and issue payslip' }).click();
    const number = slipNumber(MONTH, 'E2E-T1');
    await expect(page.getByText(`Payslip ${number} issued`).first()).toBeVisible();

    const slips = await payslipsThisMonth();
    const slip = slips.find((row) => row.staff_id === staff.teacher);
    expect(slip).toMatchObject({
      slip_number: number,
      gross_pay: 46500,
      total_deductions: 5600,
      net_pay: 40900,
      payment_method: 'DIRECT_TRANSFER',
      payment_reference: 'UTR-E2E-0001',
    });

    // The month's ledger reflects every slip issued, not just this one.
    const netTotal = slips.reduce((sum, row) => sum + row.net_pay, 0);
    await expect(staffRow(page, 'E2E Payroll Teacher')).toContainText(formatINR(40900, true));
    await expect(staffRow(page, 'E2E Payroll Teacher')).toContainText(number);
    await expect(tile(page, 'Net paid')).toHaveText(formatINR(netTotal, true));

    // The payslip PDF, inline and as a download.
    const inline = await page.request.get(`/payslips/${slip!.id}`);
    expect(inline.status()).toBe(200);
    expect(inline.headers()['content-type']).toContain('application/pdf');
    expect((await inline.body()).subarray(0, 5).toString()).toBe('%PDF-');

    const attachment = await page.request.get(`/payslips/${slip!.id}?download=1`);
    expect(attachment.headers()['content-disposition']).toBe(`attachment; filename="${number}.pdf"`);

    await page.getByRole('button', { name: 'Actions for E2E Payroll Teacher' }).click();
    await expect(page.getByRole('menuitem', { name: 'Open payslip' })).toHaveAttribute(
      'href',
      `/payslips/${slip!.id}`,
    );
    await expect(page.getByRole('menuitem', { name: 'Process salary' })).toHaveCount(0);
  });

  test('the payroll API refuses repeats, bad input and other schools', async ({ page }) => {
    const { staff } = fixtures();
    await signIn(page, 'adminA');
    const post = (data: unknown) => page.request.post('/api/payroll/process', { data });

    const repeat = await post({
      month: MONTH,
      entries: [{ staff_id: staff.teacher, payment_method: 'CASH' }],
    });
    expect(repeat.status()).toBe(409);
    expect((await repeat.json()).skipped[0].reason).toContain('Already processed');
    expect((await payslipsThisMonth()).filter((slip) => slip.staff_id === staff.teacher)).toHaveLength(1);

    const overDeducted = await post({
      month: MONTH,
      entries: [
        {
          staff_id: staff.accountant,
          deductions: [{ label: 'Advance recovery', amount: 99999 }],
          payment_method: 'CASH',
        },
      ],
    });
    expect(overDeducted.status()).toBe(409);
    expect((await overDeducted.json()).skipped[0].reason).toBe('Deductions exceed gross pay');

    const noReference = await post({
      month: MONTH,
      entries: [{ staff_id: staff.accountant, payment_method: 'CHEQUE' }],
    });
    expect(noReference.status()).toBe(400);

    const [year, month] = MONTH.split('-').map(Number);
    const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
    const future = await post({
      month: next,
      entries: [{ staff_id: staff.accountant, payment_method: 'CASH' }],
    });
    expect(future.status()).toBe(400);

    // Nothing above issued a payslip for the accountant.
    expect((await payslipsThisMonth()).some((slip) => slip.staff_id === staff.accountant)).toBe(false);

    // Tenant B's admin can neither see nor pay tenant A's staff.
    const adminB = await userDb(USERS.adminB.email);
    expect((await adminB.from('staff').select('id').eq('id', staff.accountant)).data).toEqual([]);
    expect((await adminB.from('payslips').select('id').eq('school_id', TENANT_A.id)).data).toEqual([]);
  });

  test('salary data is closed to students and to other schools', async ({ browser }) => {
    const { staff } = fixtures();
    const slips = await payslipsThisMonth();
    const slipId = slips.find((slip) => slip.staff_id === staff.teacher)!.id;

    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await signIn(studentPage, 'student');
    const asStudent = await studentPage.request.post('/api/payroll/process', {
      data: { month: MONTH, entries: [{ staff_id: staff.accountant, payment_method: 'CASH' }] },
    });
    expect(asStudent.status()).toBe(403);
    expect((await studentPage.request.get(`/payslips/${slipId}`)).status()).toBe(404);
    await studentContext.close();

    const adminBContext = await browser.newContext();
    const adminBPage = await adminBContext.newPage();
    await signIn(adminBPage, 'adminB');
    expect((await adminBPage.request.get(`/payslips/${slipId}`)).status()).toBe(404);
    const crossTenant = await adminBPage.request.post('/api/payroll/process', {
      data: { month: MONTH, entries: [{ staff_id: staff.accountant, payment_method: 'CASH' }] },
    });
    expect(crossTenant.status()).toBe(409);
    expect((await crossTenant.json()).skipped[0].reason).toBe('Staff member not found');
    await adminBContext.close();
  });

  test('paying the remaining staff in one batch settles the month', async ({ page }) => {
    const { staff } = fixtures();
    await signIn(page, 'adminA');
    await page.goto(STAFF_PAGE);

    const { data: active } = await serviceDb()
      .from('staff')
      .select('id, base_salary')
      .eq('school_id', TENANT_A.id)
      .eq('is_active', true);
    const paid = new Set((await payslipsThisMonth()).map((slip) => slip.staff_id));
    const remaining = (active ?? []).filter((member) => !paid.has(member.id));
    expect(remaining.some((member) => member.id === staff.accountant)).toBe(true);

    await page.getByRole('button', { name: `Pay remaining (${remaining.length})` }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Paid by').selectOption('CASH');
    await dialog.getByRole('button', { name: `Pay ${remaining.length}` }).click();
    await expect(page.getByText(`${remaining.length} payslip${remaining.length === 1 ? '' : 's'} issued`).first()).toBeVisible();

    await eventually(async () => {
      const slips = await payslipsThisMonth();
      return (active ?? []).every((member) => slips.some((slip) => slip.staff_id === member.id));
    }, true);

    const accountantSlip = (await payslipsThisMonth()).find((slip) => slip.staff_id === staff.accountant);
    expect(accountantSlip).toMatchObject({ net_pay: 38000, payment_method: 'CASH', payment_reference: null });

    const everyone = (active ?? []).length;
    await expect(tile(page, 'Paid')).toHaveText(`${everyone} of ${everyone}`);
    await expect(tile(page, 'Still to pay')).toHaveText(formatINR(0, true));
    await expect(page.getByRole('button', { name: 'Pay remaining (0)' })).toBeDisabled();
  });
});
