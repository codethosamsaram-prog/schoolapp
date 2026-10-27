import { expect, test } from '@playwright/test';
import { APP_PORT, TENANT_A } from './constants';
import {
  deliverWebhook,
  eventually,
  fixtures,
  gateway,
  paymentRow,
  serviceDb,
  signIn,
  studentRow,
} from './support';

const NAME = 'E2E Refund Student';

async function razorpayIds(paymentId: string) {
  const { data } = await serviceDb()
    .from('fee_payments')
    .select('razorpay_payment_id, razorpay_order_id, receipt_number, amount_paid')
    .eq('id', paymentId)
    .single();
  return data!;
}

async function refundRows(paymentId: string) {
  const { data } = await serviceDb()
    .from('fee_refunds')
    .select('razorpay_refund_id, amount, reason, status')
    .eq('payment_id', paymentId)
    .order('created_at');
  return (data ?? []).map((row) => ({ ...row, amount: Number(row.amount) }));
}

test.describe('online refunds', () => {
  test.beforeEach(async ({ request }) => {
    await gateway.reset(request);
  });

  test('a partial and then a full refund from the Fees ledger', async ({ page, request }) => {
    const f = fixtures();
    const payment = await razorpayIds(f.refundPaymentId);
    const before = await studentRow(f.students.refund);

    await signIn(page, 'adminA');
    await page.goto(`/${TENANT_A.slug}/admin/fees`);
    const actions = page.getByRole('button', {
      name: `Actions for ${NAME}'s payment ${payment.receipt_number}`,
    });
    const ledgerRow = page.getByRole('row').filter({ hasText: payment.receipt_number! });

    // 1. Partial refund of ₹4,000.
    await actions.click();
    await expect(page.getByRole('menuitem', { name: 'Void receipt' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Initiate refund' }).click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Amount (₹)')).toHaveValue(String(f.refundPaymentAmount));
    await dialog.getByLabel('Amount (₹)').fill('4000');
    await dialog.getByLabel('Reason').fill('Paid twice by mistake');
    await dialog.getByRole('button', { name: 'Issue refund' }).click();
    await expect(page.getByText('₹4,000.00 refund issued').first()).toBeVisible();

    const calls = await gateway.calls(request);
    const refundCall = calls.find((call) => call.path === `/v1/payments/${payment.razorpay_payment_id}/refund`);
    expect(refundCall?.body).toMatchObject({
      amount: 400000, // paise
      notes: { reason: 'Paid twice by mistake', fee_payment_id: f.refundPaymentId },
    });

    await eventually(async () => {
      const row = await paymentRow(f.refundPaymentId);
      return [row.status, row.amount_refunded];
    }, ['PARTIALLY_REFUNDED', 4000]);
    expect((await studentRow(f.students.refund)).current_balance).toBe(before.current_balance + 4000);
    expect(await refundRows(f.refundPaymentId)).toEqual([
      expect.objectContaining({ amount: 4000, reason: 'Paid twice by mistake', status: 'processed' }),
    ]);

    await expect(ledgerRow).toContainText('PARTIALLY REFUNDED');
    await expect(ledgerRow).toContainText('₹4,000.00 refunded');

    // 2. The rest: the dialog offers exactly what is left.
    await actions.click();
    await page.getByRole('menuitem', { name: 'Initiate refund' }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Amount (₹)')).toHaveValue('6000');
    await dialog.getByLabel('Reason').fill('Student withdrawn');
    await dialog.getByRole('button', { name: 'Issue refund' }).click();
    await expect(page.getByText('₹6,000.00 refund issued').first()).toBeVisible();

    await eventually(async () => {
      const row = await paymentRow(f.refundPaymentId);
      return [row.status, row.amount_refunded];
    }, ['REFUNDED', 10000]);
    expect((await studentRow(f.students.refund)).current_balance).toBe(before.current_balance + 10000);

    await expect(ledgerRow).toContainText('REFUNDED');
    await expect(ledgerRow).toContainText('₹10,000.00 refunded');
    await actions.click();
    await expect(page.getByRole('menuitem', { name: 'Initiate refund' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Open receipt' })).toBeVisible();
  });

  test('the refund API validates, and reports a gateway decline without recording it', async ({
    page,
    request,
  }) => {
    const f = fixtures();
    await signIn(page, 'adminA');
    const refundsBefore = await refundRows(f.declinedPaymentId);

    const tooMuch = await page.request.post('/api/payments/refund', {
      data: { payment_id: f.declinedPaymentId, reason: 'Over-refund attempt', amount: 600 },
    });
    expect(tooMuch.status()).toBe(400);
    expect((await tooMuch.json()).error).toContain('At most ₹500.00');

    const noReason = await page.request.post('/api/payments/refund', {
      data: { payment_id: f.declinedPaymentId, reason: 'x' },
    });
    expect(noReason.status()).toBe(400);

    const { data: office } = await serviceDb()
      .from('fee_payments')
      .select('id')
      .eq('student_id', f.students.portal)
      .limit(1)
      .single();
    const offline = await page.request.post('/api/payments/refund', {
      data: { payment_id: office!.id, reason: 'Office payment' },
    });
    expect(offline.status()).toBe(409);

    // The stand-in gateway declines any payment id containing DECLINE.
    const declined = await page.request.post('/api/payments/refund', {
      data: { payment_id: f.declinedPaymentId, reason: 'Gateway will say no' },
    });
    expect(declined.status()).toBe(502);
    expect((await declined.json()).error).toContain('greater than amount captured');

    expect(await refundRows(f.declinedPaymentId)).toEqual(refundsBefore);
    expect((await paymentRow(f.declinedPaymentId)).status).toBe('SUCCESS');
    expect((await gateway.calls(request)).filter((call) => call.path.endsWith('/refund'))).toHaveLength(1);
  });

  test('only a signed-in school admin can refund', async ({ browser, playwright }) => {
    const f = fixtures();

    const anonymous = await playwright.request.newContext({ baseURL: `http://localhost:${APP_PORT}` });
    const unauthenticated = await anonymous.post('/api/payments/refund', {
      data: { payment_id: f.declinedPaymentId, reason: 'No session' },
    });
    expect(unauthenticated.status()).toBe(401);
    await anonymous.dispose();

    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, 'student');
    const asStudent = await page.request.post('/api/payments/refund', {
      data: { payment_id: f.declinedPaymentId, reason: 'Student tries' },
    });
    expect(asStudent.status()).toBe(403);
    await context.close();
  });

  test('webhooks reconcile dashboard refunds, failures, and replayed captures', async ({ request }) => {
    const f = fixtures();
    const ids = await razorpayIds(f.declinedPaymentId);
    const balanceBefore = (await studentRow(f.students.refund)).current_balance;
    const refundId = `rfnd_dash${Date.now()}`;
    const refundEntity = {
      id: refundId,
      entity: 'refund',
      amount: 20000, // ₹200 in paise
      currency: 'INR',
      payment_id: ids.razorpay_payment_id,
      status: 'processed',
      notes: [],
      created_at: Math.floor(Date.now() / 1000),
    };
    const refundEvent = (event: string, status: string) => ({
      entity: 'event',
      account_id: 'acc_e2e',
      event,
      contains: ['refund', 'payment'],
      payload: { refund: { entity: { ...refundEntity, status } } },
      created_at: Math.floor(Date.now() / 1000),
    });

    // 1. A refund issued from the Razorpay dashboard is recorded, once.
    for (let delivery = 0; delivery < 2; delivery += 1) {
      const response = await deliverWebhook(request, refundEvent('refund.processed', 'processed'));
      expect(response.status()).toBe(200);
    }
    expect(await refundRows(f.declinedPaymentId)).toEqual([
      expect.objectContaining({
        razorpay_refund_id: refundId,
        amount: 200,
        status: 'processed',
        reason: 'Refunded from the Razorpay dashboard',
      }),
    ]);
    expect(await paymentRow(f.declinedPaymentId)).toMatchObject({
      status: 'PARTIALLY_REFUNDED',
      amount_refunded: 200,
    });
    expect((await studentRow(f.students.refund)).current_balance).toBe(balanceBefore + 200);

    // 2. A replayed payment.captured must not undo the refund.
    const replay = await deliverWebhook(request, {
      entity: 'event',
      account_id: 'acc_e2e',
      event: 'payment.captured',
      contains: ['payment'],
      payload: {
        payment: {
          entity: {
            id: ids.razorpay_payment_id,
            entity: 'payment',
            amount: Number(ids.amount_paid) * 100,
            currency: 'INR',
            status: 'captured',
            order_id: ids.razorpay_order_id,
            invoice_id: null,
            method: 'card',
            amount_refunded: 0,
            captured: true,
            description: null,
            email: null,
            contact: null,
            error_code: null,
            error_description: null,
            notes: {},
            created_at: Math.floor(Date.now() / 1000),
          },
        },
      },
      created_at: Math.floor(Date.now() / 1000),
    });
    expect(replay.status()).toBe(200);
    expect((await paymentRow(f.declinedPaymentId)).status).toBe('PARTIALLY_REFUNDED');

    // 3. A late refund.created does not move a processed refund back to pending.
    await deliverWebhook(request, refundEvent('refund.created', 'pending'));
    expect((await refundRows(f.declinedPaymentId))[0].status).toBe('processed');

    // 4. If the bank bounces the refund, the money counts as paid again.
    const failed = await deliverWebhook(request, refundEvent('refund.failed', 'failed'));
    expect(failed.status()).toBe(200);
    expect(await paymentRow(f.declinedPaymentId)).toMatchObject({ status: 'SUCCESS', amount_refunded: 0 });
    expect((await studentRow(f.students.refund)).current_balance).toBe(balanceBefore);
  });

  test('a webhook with a bad signature is rejected', async ({ request }) => {
    const response = await request.post('/api/webhooks/razorpay', {
      data: JSON.stringify({ event: 'refund.processed', payload: {} }),
      headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': 'not-a-signature' },
    });
    expect(response.status()).toBe(401);
  });
});
