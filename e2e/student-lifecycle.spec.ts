import { expect, test, type Page } from '@playwright/test';
import { TENANT_A } from './constants';
import { classDues, eventually, fixtures, formatINR, signIn, studentRow } from './support';

const NAME = 'E2E Lifecycle Student';

async function openEditDialog(page: Page) {
  await page.goto(`/${TENANT_A.slug}/admin/students?q=${encodeURIComponent(NAME)}`);
  await page.getByRole('button', { name: `Actions for ${NAME}` }).click();
  await page.getByRole('menuitem', { name: 'Edit details' }).click();
  return page.getByRole('dialog');
}

function rosterRow(page: Page) {
  return page.getByRole('row').filter({ hasText: NAME });
}

test.describe('student lifecycle', () => {
  test('editing details and moving class re-derives dues', async ({ page }) => {
    const { students } = fixtures();
    const id = students.lifecycle;
    const [duesIX, duesX] = await Promise.all([
      classDues(TENANT_A.id, 'IX'),
      classDues(TENANT_A.id, 'X'),
    ]);
    expect(duesX, 'classes IX and X need different schedules for this test').not.toBe(duesIX);

    const before = await studentRow(id);
    expect(before.class_grade).toBe('IX');
    expect(before.total_fee_due).toBe(duesIX);

    await signIn(page, 'adminA');

    // 1. Correct the parent's details and move to Class X in one save.
    let dialog = await openEditDialog(page);
    await dialog.getByLabel('Parent name').fill('E2E Guardian');
    await dialog.getByLabel('Parent mobile').fill('+91 98100 22222');
    await dialog.getByLabel('Class', { exact: true }).selectOption('X');
    await dialog.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('Details saved').first()).toBeVisible();

    await eventually(async () => {
      const row = await studentRow(id);
      return [row.class_grade, row.parent_name, row.parent_phone, row.total_fee_due, row.current_balance];
    }, ['X', 'E2E Guardian', '9810022222', duesX, duesX]);

    await expect(rosterRow(page)).toContainText('X-A');
    await expect(rosterRow(page)).toContainText(`of ${formatINR(duesX)}`);
    await expect(rosterRow(page)).toContainText('E2E Guardian');

    // 2. Back to Class IX: dues follow again.
    dialog = await openEditDialog(page);
    await dialog.getByLabel('Class', { exact: true }).selectOption('IX');
    await dialog.getByRole('button', { name: 'Save details' }).click();
    await expect(page.getByText('Details saved').first()).toBeVisible();

    await eventually(async () => {
      const row = await studentRow(id);
      return [row.class_grade, row.total_fee_due, row.current_balance];
    }, ['IX', duesIX, duesIX]);
    await expect(rosterRow(page)).toContainText(`of ${formatINR(duesIX)}`);
  });

  test('a roll number already taken in the class is refused and nothing changes', async ({ page }) => {
    const { students } = fixtures();
    const before = await studentRow(students.lifecycle);

    await signIn(page, 'adminA');
    const dialog = await openEditDialog(page);
    // E2E-02 belongs to the void fixture, also in IX-A.
    await dialog.getByLabel('Roll no.').fill('E2E-02');
    await dialog.getByLabel('Parent name').fill('Should Not Save');
    await dialog.getByRole('button', { name: 'Save details' }).click();

    await expect(dialog.getByText('Already taken in this class and section')).toBeVisible();
    expect(await studentRow(students.lifecycle)).toEqual(before);
  });

  test('an invalid mobile number is caught before saving', async ({ page }) => {
    const { students } = fixtures();
    const before = await studentRow(students.lifecycle);

    await signIn(page, 'adminA');
    const dialog = await openEditDialog(page);
    await dialog.getByLabel('Parent mobile').fill('12345');
    await dialog.getByRole('button', { name: 'Save details' }).click();

    await expect(dialog.getByText('Enter a 10-digit Indian mobile number')).toBeVisible();
    expect(await studentRow(students.lifecycle)).toEqual(before);
  });
});
