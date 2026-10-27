import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { TENANT_A, USERS } from './constants';
import { fixtures, formatINR, signIn, studentRow } from './support';

const PORTAL = `/${TENANT_A.slug}/portal`;

test.describe('student portal', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'student');
  });

  test('syllabus copies open and download as PDFs', async ({ page }) => {
    const f = fixtures();
    await page.goto(`${PORTAL}/syllabus`);
    await expect(page.getByText(f.portalSyllabusSubject)).toBeVisible();

    const download = page.getByRole('link', { name: `Download ${f.portalSyllabusSubject} syllabus` });
    const href = await download.getAttribute('href');
    expect(href).toBeTruthy();

    const file = await page.request.get(href!);
    expect(file.status()).toBe(200);
    expect((await file.body()).subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('results show on screen and the report card downloads', async ({ page }) => {
    const f = fixtures();
    await page.goto(`${PORTAL}/exams`);

    await expect(page.getByText(f.portalExam, { exact: true })).toBeVisible();
    // 78 + 91 + 30 of 300, with English below the 33% pass mark.
    await expect(page.getByText('66.3%').first()).toBeVisible();
    await expect(page.getByText('1 subject below pass')).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Report card' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`report-card-${USERS.student.usn}-E2E-Term-Test.pdf`);
    const saved = await download.path();
    expect(fs.readFileSync(saved!).subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('the fee balance matches the ledger', async ({ page }) => {
    const f = fixtures();
    const student = await studentRow(f.students.portal);
    expect(student.current_balance).toBe(student.total_fee_due - 20000);

    await page.goto(`${PORTAL}/fees`);
    const figure = (label: string) =>
      page.locator('dl > div').filter({ has: page.locator('dt', { hasText: label }) }).locator('dd');

    await expect(figure('Balance due')).toHaveText(formatINR(student.current_balance));
    await expect(figure('Paid')).toHaveText(formatINR(20000));
    await expect(page.getByText(formatINR(20000, true)).first()).toBeVisible();
  });

  test("a student cannot open another student's report card or the admin area", async ({ page }) => {
    const f = fixtures();

    const other = await page.request.get(
      `/report-cards/${f.students.lifecycle}?exam=${encodeURIComponent(f.portalExam)}`,
    );
    expect(other.status()).toBe(404);

    const own = await page.request.get(
      `/report-cards/${f.students.portal}?exam=${encodeURIComponent(f.portalExam)}`,
    );
    expect(own.status()).toBe(200);

    await page.goto(`/${TENANT_A.slug}/admin/dashboard`);
    await expect(page).toHaveURL(/error=insufficient-role/);
  });
});
