import fs from 'node:fs';
import QRCode from 'qrcode';
import { expect, test, type Page } from '@playwright/test';
import { TENANT_A } from './constants';
import { fixtures, serviceDb, signIn } from './support';

/** Must match QR_OPTIONS in lib/id-cards.ts (server-only, so not importable here). */
const QR_OPTIONS = { errorCorrectionLevel: 'M', margin: 1, width: 240 } as const;
const CARDS_PER_PAGE = 4;

async function activeInSection(grade: string, section: string) {
  const { data } = await serviceDb()
    .from('students')
    .select('id, full_name')
    .eq('school_id', TENANT_A.id)
    .eq('class_grade', grade)
    .eq('section', section)
    .eq('is_active', true);
  return data ?? [];
}

/** Leaf page objects; "/Type /Pages" is the page tree, not a page. */
function pdfPageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)\b/g) ?? []).length;
}

async function downloadPdf(page: Page, trigger: () => Promise<void>) {
  const [download] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const file = fs.readFileSync((await download.path())!);
  return { name: download.suggestedFilename(), file };
}

test.describe('student ID cards', () => {
  test('previewing a section shows one card per active student, with a QR of their id', async ({
    page,
  }) => {
    const { students } = fixtures();
    const expected = await activeInSection('IX', 'A');

    await signIn(page, 'adminA');
    await page.goto(`/${TENANT_A.slug}/admin/students`);
    await page.getByRole('link', { name: 'ID cards' }).click();
    await expect(page.getByRole('heading', { name: 'Student ID cards' })).toBeVisible();
    await page.getByLabel('Class', { exact: true }).selectOption('IX');
    await page.getByLabel('Section', { exact: true }).selectOption('A');
    await page.getByRole('button', { name: 'Show cards' }).click();

    const cards = page.locator('[data-student-id]');
    await expect(cards).toHaveCount(expected.length);
    await expect(page.getByText(`${expected.length} of ${expected.length} cards selected`)).toBeVisible();

    const portal = page.locator(`[data-student-id="${students.portal}"]`);
    await expect(portal.getByLabel("Front of E2E Portal Student's card")).toContainText('Blood group B+');
    await expect(portal.getByLabel("Back of E2E Portal Student's card")).toContainText('+91 9810000000');
    await expect(portal.getByLabel("Back of E2E Portal Student's card")).toContainText('Sector 24, Rohini');

    const qr = portal.getByRole('img', { name: 'QR code for E2E Portal Student' });
    await expect(qr).toHaveAttribute('src', await QRCode.toDataURL(students.portal, QR_OPTIONS));
  });

  test('bulk download includes exactly the selected students', async ({ page }) => {
    const { students } = fixtures();
    const expected = await activeInSection('IX', 'A');

    await signIn(page, 'adminA');
    await page.goto(`/${TENANT_A.slug}/admin/students/id-cards?grade=IX&section=A`);

    // Two chosen students fit on one page.
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByRole('button', { name: /Download PDF \(0\)/ })).toBeDisabled();
    await page.getByRole('checkbox', { name: /E2E Portal Student/ }).check();
    await page.getByRole('checkbox', { name: /E2E Void Student/ }).check();

    const two = await downloadPdf(page, () =>
      page.getByRole('button', { name: 'Download PDF (2)' }).click(),
    );
    expect(two.name).toBe('id-cards-class-IX-A.pdf');
    expect(two.file.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdfPageCount(two.file)).toBe(1);

    // The whole section: four students to a page.
    await page.getByRole('button', { name: 'Select all' }).click();
    const all = await downloadPdf(page, () =>
      page.getByRole('button', { name: `Download PDF (${expected.length})` }).click(),
    );
    expect(pdfPageCount(all.file)).toBe(Math.ceil(expected.length / CARDS_PER_PAGE));

    // The API reports how many cards it rendered for a given selection.
    const selected = await page.request.get(
      `/api/id-cards?grade=IX&section=A&student=${students.portal}&student=${students.void}`,
    );
    expect(selected.headers()['x-card-count']).toBe('2');
  });

  test('the rendering pipeline rejects bad input and stays inside the tenant', async ({ page, browser }) => {
    const f = fixtures();
    await signIn(page, 'adminA');

    const section = await page.request.get('/api/id-cards?grade=IX&section=A');
    expect(section.status()).toBe(200);
    expect(section.headers()['content-disposition']).toMatch(/^inline;/);

    expect((await page.request.get('/api/id-cards?grade=IX')).status()).toBe(400);
    expect((await page.request.get('/api/id-cards?grade=IX&section=A&student=not-a-uuid')).status()).toBe(400);
    expect((await page.request.get('/api/id-cards?grade=Nursery&section=E')).status()).toBe(404);

    // A tenant B student cannot be printed from tenant A, even by id.
    const { data: tenantB } = await serviceDb()
      .from('students')
      .select('class_grade, section')
      .eq('id', f.tenantBStudentId)
      .single();
    const crossTenant = await page.request.get(
      `/api/id-cards?grade=${tenantB!.class_grade}&section=${tenantB!.section}&student=${f.tenantBStudentId}`,
    );
    expect(crossTenant.status()).toBe(404);

    // Mixed with a real student, the foreign id is simply dropped.
    const mixed = await page.request.get(
      `/api/id-cards?grade=IX&section=A&student=${f.students.portal}&student=${f.tenantBStudentId}`,
    );
    expect(mixed.headers()['x-card-count']).toBe('1');

    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await signIn(studentPage, 'student');
    expect((await studentPage.request.get('/api/id-cards?grade=IX&section=A')).status()).toBe(403);
    await studentContext.close();
  });
});
