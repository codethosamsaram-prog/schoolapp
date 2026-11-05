import crypto from 'node:crypto';
import { expect, test } from '@playwright/test';
import { TENANT_A, USERS } from './constants';
import { eventually, fixtures, serviceDb, signIn, studentRow, userDb } from './support';

/**
 * Direct UPI from QR to receipt: an admin sets the school's UPI ID, a parent
 * pays and reports the UTR, and the school approves it by hand or by matching a
 * bank statement. The steps build on each other.
 */

const VPA = 'e2e-school@okaxis';
const PAY_PAGE = `/${TENANT_A.slug}/portal/pay-upi`;
const QUEUE_PAGE = `/${TENANT_A.slug}/admin/finance/utr-verification`;

function newUtr(): string {
  return `9${crypto.randomInt(10 ** 10, 10 ** 11 - 1)}`;
}

async function claimByUtr(utr: string) {
  const { data } = await serviceDb()
    .from('upi_payment_claims')
    .select('id, status, amount, payment_id, review_note')
    .eq('utr', utr)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

test.describe('UPI payment by UTR', () => {
  test.describe.configure({ mode: 'serial' });

  const handUtr = newUtr();

  test.afterAll(async () => {
    await serviceDb().from('schools').update({ upi_vpa: null }).eq('id', TENANT_A.id);
  });

  test('an admin sets the UPI ID; a malformed one is refused', async ({ page }) => {
    await signIn(page, 'adminA');
    await page.goto(QUEUE_PAGE);

    await page.getByLabel('UPI ID').fill('not a vpa');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Enter a UPI ID like' })).toBeVisible();

    await page.getByLabel('UPI ID').fill(VPA);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('UPI ID saved').first()).toBeVisible();

    const { data: school } = await serviceDb().from('schools').select('upi_vpa').eq('id', TENANT_A.id).single();
    expect(school?.upi_vpa).toBe(VPA);
  });

  test('the QR carries the payment, and reporting a UTR credits nothing yet', async ({ page }) => {
    const f = fixtures();
    const before = await studentRow(f.familyStudent);
    expect(before.current_balance).toBeGreaterThan(1500);

    await signIn(page, 'parent');
    await page.goto(PAY_PAGE);

    const qr = page.getByTestId('upi-qr');
    await expect(qr.locator('svg')).toBeVisible();
    const fullUri = await qr.getAttribute('data-upi-uri');
    expect(fullUri).toContain('upi://pay?pa=e2e-school%40okaxis');
    expect(fullUri).toContain(`am=${before.current_balance.toFixed(2)}`);
    expect(fullUri).toMatch(/tn=FEE-E2E-FAMILY-/);

    // The QR follows the amount, and an impossible amount shows no QR at all.
    await page.getByLabel('1. Amount to pay').fill('999999999');
    await expect(qr.locator('svg')).toHaveCount(0);
    await page.getByLabel('1. Amount to pay').fill('500');
    await expect(qr).toHaveAttribute('data-upi-uri', /am=500\.00/);

    await page.getByLabel('2. UPI reference (UTR) from your app').fill('12345');
    await page.getByRole('button', { name: 'Report payment' }).click();
    await expect(page.getByRole('alert').filter({ hasText: '12-digit reference' })).toBeVisible();

    await page.getByLabel('2. UPI reference (UTR) from your app').fill(handUtr);
    await page.getByRole('button', { name: 'Report payment' }).click();
    await expect(page.getByText('Payment reported').first()).toBeVisible();

    const reported = page.getByRole('list', { name: 'Reported UPI payments' }).getByRole('listitem').filter({ hasText: handUtr });
    await expect(reported).toContainText('₹500');
    expect((await claimByUtr(handUtr))?.status).toBe('PENDING');
    expect((await studentRow(f.familyStudent)).current_balance).toBe(before.current_balance);

    // The invoice PDF that carries the same QR.
    const invoice = await page.request.get(`/invoices/${f.familyStudent}`);
    expect(invoice.status()).toBe(200);
    expect(invoice.headers()['content-type']).toContain('application/pdf');
    expect((await invoice.body()).subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('the claim endpoint refuses bad, repeated, excessive and foreign claims', async ({ page, browser }) => {
    const f = fixtures();
    await signIn(page, 'parent');
    const claim = (data: Record<string, unknown>) => page.request.post('/api/payments/utr-claim', { data });
    const good = { studentId: f.familyStudent, amount: 100 };

    expect((await claim({ ...good, utr: '12345678901' })).status()).toBe(400);
    expect((await claim({ ...good, utr: '12345678901a' })).status()).toBe(400);
    expect((await claim({ ...good, utr: handUtr })).status()).toBe(409);

    const { current_balance: balance } = await studentRow(f.familyStudent);
    expect((await claim({ ...good, amount: balance + 1, utr: newUtr() })).status()).toBe(422);
    // RLS hides another family's child entirely.
    expect((await claim({ ...good, studentId: f.students.void, utr: newUtr() })).status()).toBe(404);

    // A direct insert for someone else's child is refused too.
    const parentDb = await userDb(USERS.parent.email);
    const foreign = await parentDb.from('upi_payment_claims').insert({
      school_id: TENANT_A.id,
      student_id: f.students.void,
      amount: 10,
      utr: newUtr(),
      submitted_by: f.users.parent,
    });
    expect(foreign.error?.code).toBe('42501');

    // Reporting is for families.
    const staffContext = await browser.newContext();
    const teacher = await staffContext.newPage();
    await signIn(teacher, 'teacher');
    const staffClaim = await teacher.request.post('/api/payments/utr-claim', { data: { ...good, utr: newUtr() } });
    expect(staffClaim.status()).toBe(403);
    await staffContext.close();
  });

  test('neither the family nor another school can decide a claim', async () => {
    const claim = await claimByUtr(handUtr);
    const review = { target_claim: claim!.id, approve: true, note: null };

    const parentDb = await userDb(USERS.parent.email);
    expect((await parentDb.rpc('review_upi_claim', review)).error).toBeTruthy();
    await parentDb.from('upi_payment_claims').update({ status: 'APPROVED' }).eq('id', claim!.id);

    const adminB = await userDb(USERS.adminB.email);
    expect((await adminB.rpc('review_upi_claim', review)).error).toBeTruthy();
    expect((await adminB.from('upi_payment_claims').select('id').eq('id', claim!.id)).data).toEqual([]);

    expect((await claimByUtr(handUtr))?.status).toBe('PENDING');
  });

  test('approval issues a receipt, moves the balance and tells the family', async ({ page, browser }) => {
    const f = fixtures();
    const before = await studentRow(f.familyStudent);

    await signIn(page, 'adminA');
    await page.goto(QUEUE_PAGE);
    const row = page.locator(`li[data-utr="${handUtr}"]`);
    await expect(row).toContainText('E2E Family Student');
    await row.getByRole('button', { name: `Approve UTR ${handUtr}` }).click();
    await expect(page.getByText(`UTR ${handUtr} approved`).first()).toBeVisible();

    await eventually(async () => (await claimByUtr(handUtr))?.status, 'APPROVED');
    const claim = await claimByUtr(handUtr);
    const { data: payment } = await serviceDb()
      .from('fee_payments')
      .select('status, amount_paid, receipt_number, payment_method, receipt_url')
      .eq('id', claim!.payment_id!)
      .single();
    expect(payment).toMatchObject({ status: 'SUCCESS', payment_method: `UPI (UTR ${handUtr})` });
    expect(Number(payment?.amount_paid)).toBe(500);
    expect(payment?.receipt_number).toBeTruthy();
    expect((await studentRow(f.familyStudent)).current_balance).toBe(before.current_balance - 500);

    const { data: told } = await serviceDb()
      .from('notifications')
      .select('title, body')
      .eq('user_id', f.users.parent)
      .eq('title', 'UPI payment verified')
      .like('body', `%${handUtr}%`);
    expect(told).toHaveLength(1);

    // A decision is final.
    const adminDb = await userDb(USERS.adminA.email);
    const again = await adminDb.rpc('review_upi_claim', { target_claim: claim!.id, approve: true, note: null });
    expect(again.error?.message).toContain('already been approved');

    const parentContext = await browser.newContext();
    const parent = await parentContext.newPage();
    await signIn(parent, 'parent');
    await parent.goto(PAY_PAGE);
    const mine = parent.getByRole('list', { name: 'Reported UPI payments' }).getByRole('listitem').filter({ hasText: handUtr });
    await expect(mine.getByRole('link', { name: 'Receipt' })).toBeVisible();
    const receipt = await parent.request.get(`/receipts/${claim!.payment_id}`);
    expect(receipt.status()).toBe(200);
    expect((await receipt.body()).subarray(0, 5).toString()).toBe('%PDF-');
    await parentContext.close();
  });

  test('a rejected claim shows its reason and frees the UTR', async ({ page, browser }) => {
    const f = fixtures();
    const utr = newUtr();
    const parentDb = await userDb(USERS.parent.email);
    must(
      await parentDb.from('upi_payment_claims').insert({
        school_id: TENANT_A.id,
        student_id: f.familyStudent,
        amount: 250,
        utr,
        submitted_by: f.users.parent,
      }),
    );
    const before = await studentRow(f.familyStudent);

    await signIn(page, 'adminA');
    await page.goto(QUEUE_PAGE);
    await page.getByRole('button', { name: `Reject UTR ${utr}` }).click();
    await page.getByLabel(`Reason for rejecting UTR ${utr}`).fill('Not on our statement');
    await page.getByRole('button', { name: 'Confirm reject' }).click();
    await expect(page.getByText(`UTR ${utr} rejected`).first()).toBeVisible();

    await eventually(async () => (await claimByUtr(utr))?.status, 'REJECTED');
    expect((await claimByUtr(utr))?.payment_id).toBeNull();
    expect((await studentRow(f.familyStudent)).current_balance).toBe(before.current_balance);

    const parentContext = await browser.newContext();
    const parent = await parentContext.newPage();
    await signIn(parent, 'parent');
    await parent.goto(PAY_PAGE);
    await expect(parent.getByText('School: Not on our statement')).toBeVisible();
    const retry = await parent.request.post('/api/payments/utr-claim', {
      data: { studentId: f.familyStudent, amount: 250, utr },
    });
    expect(retry.status()).toBe(201);
    await parentContext.close();
  });

  test('a bank statement approves exact matches and leaves the rest pending', async ({ page }) => {
    const f = fixtures();
    const [matching, wrongAmount, absent] = [newUtr(), newUtr(), newUtr()];
    const parentDb = await userDb(USERS.parent.email);
    must(
      await parentDb.from('upi_payment_claims').insert(
        [
          [matching, 300],
          [wrongAmount, 400],
          [absent, 200],
        ].map(([utr, amount]) => ({
          school_id: TENANT_A.id,
          student_id: f.familyStudent,
          utr: String(utr),
          amount: Number(amount),
          submitted_by: f.users.parent,
        })),
      ),
    );

    await signIn(page, 'adminA');
    await page.goto(QUEUE_PAGE);
    await page
      .getByLabel('Bank statement rows')
      .fill(`01/11/2026,UPI/${matching}/FEES,300.00,99000.00\n01/11/2026,UPI/${wrongAmount}/FEES,40.00,99040.00`);
    await page.getByRole('button', { name: 'Match and approve' }).click();

    const summary = page.getByRole('status').filter({ hasText: '1 approved' });
    await expect(summary).toContainText(wrongAmount);
    expect((await claimByUtr(matching))?.status).toBe('APPROVED');
    expect((await claimByUtr(wrongAmount))?.status).toBe('PENDING');
    expect((await claimByUtr(absent))?.status).toBe('PENDING');
  });
});

function must(result: { error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message);
}
