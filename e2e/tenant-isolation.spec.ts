import { expect, test } from '@playwright/test';
import { TENANT_A, TENANT_B, USERS } from './constants';
import { fixtures, serviceDb, signIn, userDb } from './support';

/**
 * The RLS boundary between tenants, tested the way an attacker would probe it:
 * with a real tenant A admin session talking to PostgREST directly, not only
 * through pages that might filter for them.
 */

const TABLES = ['students', 'fee_structures', 'fee_payments'] as const;

test.describe('tenant isolation', () => {
  test('tenant B has data of its own, so the checks below mean something', async () => {
    const db = serviceDb();
    for (const table of TABLES) {
      const { count } = await db
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('school_id', TENANT_B.id);
      expect(count, `tenant B ${table}`).toBeGreaterThan(0);
    }
  });

  test('a tenant A admin reads no tenant B rows, filtered or not', async () => {
    const f = fixtures();
    const adminA = await userDb(USERS.adminA.email);

    for (const table of TABLES) {
      const targeted = await adminA.from(table).select('id, school_id').eq('school_id', TENANT_B.id);
      expect(targeted.error, table).toBeNull();
      expect(targeted.data, `${table} filtered to tenant B`).toEqual([]);

      const everything = await adminA.from(table).select('school_id').limit(1000);
      expect(everything.error, table).toBeNull();
      expect(everything.data!.length, `${table} visible to tenant A`).toBeGreaterThan(0);
      expect(
        everything.data!.every((row) => row.school_id === TENANT_A.id),
        `${table} unfiltered rows all belong to tenant A`,
      ).toBe(true);
    }

    const byId = await adminA.from('students').select('id').eq('id', f.tenantBStudentId);
    expect(byId.data).toEqual([]);
    const paymentById = await adminA.from('fee_payments').select('id').eq('id', f.tenantBPaymentId);
    expect(paymentById.data).toEqual([]);

    const metrics = await adminA.rpc('school_dashboard_metrics', { target_school: TENANT_B.id });
    expect(metrics.data?.[0]?.students_total ?? 0).toBe(0);
  });

  test('a tenant A admin cannot write into tenant B', async () => {
    const f = fixtures();
    const adminA = await userDb(USERS.adminA.email);
    const db = serviceDb();

    const insertStudent = await adminA.from('students').insert({
      school_id: TENANT_B.id,
      full_name: 'E2E Intruder',
      roll_number: 'E2E-X',
      class_grade: 'XI',
      parent_phone: '9810000000',
    });
    expect(insertStudent.error?.code).toBe('42501');

    const insertPayment = await adminA.from('fee_payments').insert({
      school_id: TENANT_B.id,
      student_id: f.tenantBStudentId,
      amount_paid: 1,
      status: 'SUCCESS',
    });
    expect(insertPayment.error).not.toBeNull();

    // Updates and deletes through RLS match nothing rather than erroring.
    const { data: headB } = await db
      .from('fee_structures')
      .select('id, amount')
      .eq('school_id', TENANT_B.id)
      .limit(1)
      .single();
    const update = await adminA
      .from('fee_structures')
      .update({ amount: 1 })
      .eq('id', headB!.id)
      .select('id');
    expect(update.data).toEqual([]);

    const remove = await adminA.from('fee_payments').delete().eq('id', f.tenantBPaymentId).select('id');
    expect(remove.data ?? []).toEqual([]);

    const { data: after } = await db.from('fee_structures').select('amount').eq('id', headB!.id).single();
    expect(Number(after!.amount)).toBe(Number(headB!.amount));
    const { count } = await db
      .from('fee_payments')
      .select('id', { count: 'exact', head: true })
      .eq('id', f.tenantBPaymentId);
    expect(count).toBe(1);
  });

  test('tenant B pages and documents are closed to a tenant A admin', async ({ page }) => {
    const f = fixtures();
    await signIn(page, 'adminA');

    await page.goto(`/${TENANT_B.slug}/admin/students`);
    await expect(page).toHaveURL(new RegExp(`/${TENANT_B.slug}\\?error=forbidden`));
    await expect(page.getByText(f.tenantBStudentName)).toHaveCount(0);

    const receipt = await page.request.get(`/receipts/${f.tenantBPaymentId}`);
    expect(receipt.status()).toBe(404);

    const reportCard = await page.request.get(
      `/report-cards/${f.tenantBStudentId}?exam=${encodeURIComponent('Unit Test 1')}`,
    );
    expect(reportCard.status()).toBe(404);

    const refund = await page.request.post('/api/payments/refund', {
      data: { payment_id: f.tenantBPaymentId, reason: 'Cross-tenant probe' },
    });
    expect(refund.status()).toBe(404);
  });

  test('isolation holds in the other direction too', async () => {
    const f = fixtures();
    const adminB = await userDb(USERS.adminB.email);

    const own = await adminB.from('fee_payments').select('id').eq('id', f.tenantBPaymentId);
    expect(own.data).toHaveLength(1);

    const other = await adminB.from('students').select('id').eq('id', f.students.portal);
    expect(other.data).toEqual([]);
    const otherPayment = await adminB.from('fee_payments').select('id').eq('id', f.refundPaymentId);
    expect(otherPayment.data).toEqual([]);
  });
});
