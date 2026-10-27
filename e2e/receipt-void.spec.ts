import { expect, test } from '@playwright/test';
import { TENANT_A, USERS } from './constants';
import {
  eventually,
  fixtures,
  formatINR,
  paymentRow,
  serviceDb,
  signIn,
  studentRow,
  userDb,
} from './support';

const NAME = 'E2E Void Student';
const AMOUNT = 2500;

test.describe('office receipts', () => {
  test('a cash payment reduces the balance, and voiding it restores the balance', async ({ page }) => {
    const { students } = fixtures();
    const id = students.void;
    const before = await studentRow(id);
    expect(before.current_balance).toBeGreaterThan(AMOUNT);

    await signIn(page, 'adminA');

    // 1. Record cash at the office.
    await page.goto(`/${TENANT_A.slug}/admin/students?q=${encodeURIComponent(NAME)}`);
    await page.getByRole('button', { name: `Actions for ${NAME}` }).click();
    await page.getByRole('menuitem', { name: 'Record payment' }).click();
    const payDialog = page.getByRole('dialog');
    await payDialog.getByLabel('Amount (₹)').fill(String(AMOUNT));
    await payDialog.getByRole('button', { name: 'Record and issue receipt' }).click();
    await expect(page.getByText(/Receipt .* issued/).first()).toBeVisible();

    await eventually(async () => (await studentRow(id)).current_balance, before.current_balance - AMOUNT);
    await expect(page.getByRole('row').filter({ hasText: NAME })).toContainText(
      formatINR(before.current_balance - AMOUNT),
    );

    const { data: payment } = await serviceDb()
      .from('fee_payments')
      .select('id, receipt_number, status, amount_paid')
      .eq('student_id', id)
      .eq('amount_paid', AMOUNT)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    expect(payment).toMatchObject({ status: 'SUCCESS', amount_paid: AMOUNT });
    expect(payment!.receipt_number).toBeTruthy();

    // 2. Void it from the Fees ledger; a reason is required.
    await page.goto(`/${TENANT_A.slug}/admin/fees`);
    const actions = page.getByRole('button', {
      name: `Actions for ${NAME}'s payment ${payment!.receipt_number}`,
    });
    await actions.click();
    await expect(page.getByRole('menuitem', { name: 'Initiate refund' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Void receipt' }).click();

    const voidDialog = page.getByRole('dialog');
    await voidDialog.getByRole('button', { name: 'Void receipt' }).click();
    await expect(voidDialog.getByText('Say why this receipt is being voided')).toBeVisible();
    expect((await paymentRow(payment!.id)).status).toBe('SUCCESS');

    await voidDialog.getByLabel('Reason').fill('Entered against the wrong student');
    await voidDialog.getByRole('button', { name: 'Void receipt' }).click();
    await expect(page.getByText(/voided/).first()).toBeVisible();

    await eventually(async () => {
      const row = await paymentRow(payment!.id);
      return [row.status, row.void_reason];
    }, ['VOIDED', 'Entered against the wrong student']);
    await eventually(async () => (await studentRow(id)).current_balance, before.current_balance);

    const ledgerRow = page.getByRole('row').filter({ hasText: payment!.receipt_number! });
    await expect(ledgerRow).toContainText('VOIDED');
    await expect(ledgerRow).toContainText('Entered against the wrong student');

    // 3. The voided receipt still opens, and cannot be voided twice.
    const pdf = await page.request.get(`/receipts/${payment!.id}`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');

    await actions.click();
    await expect(page.getByRole('menuitem', { name: 'Open receipt' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Void receipt' })).toHaveCount(0);
  });

  test('the database refuses to void an online payment or reinstate a void', async () => {
    const { refundPaymentId } = fixtures();
    const adminA = await userDb(USERS.adminA.email);

    const online = await adminA
      .from('fee_payments')
      .update({ status: 'VOIDED', void_reason: 'Trying to void an online payment' })
      .eq('id', refundPaymentId)
      .select('id');
    expect(online.error?.message).toContain('refunded through the gateway');

    // A voided office payment of its own, so this test stands alone.
    const { students } = fixtures();
    const { data: office } = await serviceDb()
      .from('fee_payments')
      .insert({
        school_id: TENANT_A.id,
        student_id: students.void,
        amount_paid: 100,
        payment_method: 'Cash',
        status: 'SUCCESS',
        receipt_number: `E2E-V-${Date.now()}`,
        paid_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    const withoutReason = await adminA
      .from('fee_payments')
      .update({ status: 'VOIDED' })
      .eq('id', office!.id)
      .select('id');
    expect(withoutReason.error?.message).toContain('a void needs a reason');

    const voided = await adminA
      .from('fee_payments')
      .update({ status: 'VOIDED', void_reason: 'Test void' })
      .eq('id', office!.id)
      .select('status')
      .single();
    expect(voided.data?.status).toBe('VOIDED');

    const reinstate = await adminA
      .from('fee_payments')
      .update({ status: 'SUCCESS' })
      .eq('id', office!.id)
      .select('id');
    expect(reinstate.error?.message).toContain('voided payment cannot be changed');
  });
});
