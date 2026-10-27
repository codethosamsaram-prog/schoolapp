import { expect, test, type Page } from '@playwright/test';
import { TENANT_A, USERS } from './constants';
import { eventually, fixtures, serviceDb, signIn, studentEmail, userDb } from './support';
import { monthLabel, thisMonth } from '../lib/transport';

/**
 * Routes and stops, allocating a student to a stop, the monthly fees that
 * follows, and what the parent sees. The steps build on each other.
 */

const TRANSPORT = `/${TENANT_A.slug}/admin/transport`;

/** Months left in the academic year (April to March), this one included. */
function monthsLeftInYear(): number {
  const month = Number(thisMonth().slice(5, 7));
  return month >= 4 ? 12 - month + 4 : 4 - month;
}

async function transportCharges(studentId: string) {
  const { data } = await serviceDb()
    .from('fee_structures')
    .select('title, amount, transport_month')
    .eq('student_id', studentId)
    .not('transport_month', 'is', null)
    .order('transport_month');
  return (data ?? []).map((row) => ({ month: row.transport_month!, amount: Number(row.amount), title: row.title }));
}

async function dues(studentId: string) {
  const { data } = await serviceDb()
    .from('students')
    .select('total_fee_due, current_balance')
    .eq('id', studentId)
    .single();
  return { due: Number(data!.total_fee_due), balance: Number(data!.current_balance) };
}

function riderRow(page: Page) {
  return page.getByRole('row').filter({ hasText: 'E2E Family Student' });
}

test.describe('transport', () => {
  test.describe.configure({ mode: 'serial' });

  test('an admin adds a route with its vehicle, driver and a stop', async ({ page }) => {
    await signIn(page, 'adminA');
    await page.goto(TRANSPORT);

    await page.getByRole('button', { name: 'Add route' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Route name').fill('E2E Route 9');
    await dialog.getByLabel('Vehicle registration').fill('dl 1pc 4455');
    await dialog.getByLabel('Driver', { exact: true }).fill('Suresh Yadav');
    await dialog.getByLabel('Driver mobile').fill('98111 00009');
    await dialog.getByRole('button', { name: 'Add route' }).click();
    await expect(page.getByText('Route added').first()).toBeVisible();

    const card = page.locator('[aria-label="Route E2E Route 9"]');
    await expect(card).toContainText('DL 1PC 4455');
    await expect(card).toContainText('9811100009');

    const addStop = card.getByRole('form', { name: 'Add a stop to E2E Route 9' });
    await addStop.getByLabel('Stop name').fill('E2E Pitampura TV Tower');
    await addStop.getByLabel('Pick-up time').fill('06:55');
    await addStop.getByLabel('Drop time').fill('14:50');
    await addStop.getByLabel('Monthly fee (₹)').fill('1800');
    await addStop.getByRole('button', { name: 'Add stop' }).click();
    await expect(card.getByRole('row').filter({ hasText: 'E2E Pitampura TV Tower' })).toContainText('6:55 am');

    // Route names are unique within the school.
    await page.getByRole('button', { name: 'Add route' }).click();
    const again = page.getByRole('dialog');
    await again.getByLabel('Route name').fill('E2E Route 9');
    await again.getByLabel('Vehicle registration').fill('DL 1PC 9999');
    await again.getByLabel('Driver', { exact: true }).fill('Someone Else');
    await again.getByLabel('Driver mobile').fill('9811100010');
    await again.getByRole('button', { name: 'Add route' }).click();
    await expect(again.getByText('Already exists')).toBeVisible();
  });

  test('allocating a stop adds its monthly fee to the ledger and shows the bus to the parent', async ({
    page,
    browser,
  }) => {
    const f = fixtures();
    const before = await dues(f.familyStudent);
    const months = monthsLeftInYear();

    await signIn(page, 'adminA');
    await page.goto(TRANSPORT);
    await page.getByLabel('Student', { exact: true }).selectOption({ label: 'E2E Family Student · IX-A · Roll E2E-05' });
    await page.getByLabel('Pick-up point').selectOption(f.transport.marketStop);
    await page.getByRole('button', { name: 'Assign' }).click();
    await expect(page.getByText(`billed from ${monthLabel(thisMonth())}`).first()).toBeVisible();

    // One charge per remaining month of the academic year, in the Bus category.
    await eventually(async () => (await transportCharges(f.familyStudent)).length, months);
    const charges = await transportCharges(f.familyStudent);
    expect(charges[0]).toMatchObject({ month: thisMonth(), amount: 1500 });
    expect(charges.every((charge) => charge.amount === 1500)).toBe(true);
    expect(charges[0].title).toBe(`Transport · ${monthLabel(thisMonth())}`);

    const after = await dues(f.familyStudent);
    expect(after.due - before.due).toBe(1500 * months);
    expect(after.balance - before.balance).toBe(1500 * months);
    await expect(riderRow(page)).toContainText('E2E Sector 9 Market');

    // The parent's portal: bus details on the home page, charges on the fee page.
    const context = await browser.newContext();
    const parent = await context.newPage();
    await signIn(parent, 'parent');
    const bus = parent.locator('[aria-labelledby="bus-heading"]');
    await expect(bus).toContainText('E2E Route 7');
    await expect(bus).toContainText('E2E Sector 9 Market');
    await expect(bus).toContainText('Pick-up 7:10 am');
    await expect(bus).toContainText('Ramesh Kumar');
    await expect(bus.getByRole('link', { name: '+91 9811100007' })).toHaveAttribute('href', 'tel:+919811100007');
    await expect(bus).toContainText('On schedule');

    await parent.goto(`/${TENANT_A.slug}/portal/fees`);
    await expect(parent.getByText(`Transport · ${monthLabel(thisMonth())}`)).toBeVisible();
    await context.close();

    // RLS: the parent can read their child's route and nothing else; a family
    // with no rider reads no routes at all.
    const parentDb = await userDb(USERS.parent.email);
    const visible = await parentDb.from('transport_routes').select('name');
    expect(visible.data?.map((row) => row.name)).toEqual(['E2E Route 7']);
    const studentDb = await userDb(studentEmail());
    expect((await studentDb.from('transport_routes').select('id')).data).toEqual([]);
  });

  test('changing stop bills the new stop from next month, never twice', async ({ page }) => {
    const f = fixtures();
    const months = monthsLeftInYear();

    await signIn(page, 'adminA');
    await page.goto(TRANSPORT);
    await page.getByRole('button', { name: 'Change stop for E2E Family Student' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('New pick-up point').selectOption(f.transport.eastStop);
    await dialog.getByRole('button', { name: 'Change stop' }).click();
    await expect(page.getByText('E2E Family Student: stop changed').first()).toBeVisible();

    await eventually(async () => (await transportCharges(f.familyStudent)).map((charge) => charge.amount), [
      1500,
      ...Array<number>(months - 1).fill(2000),
    ]);
  });

  test('the bus status set by the office reaches the parent', async ({ page, browser }) => {
    await signIn(page, 'adminA');
    await page.goto(TRANSPORT);
    const status = page.getByRole('form', { name: 'Bus status for E2E Route 7' });
    await status.getByLabel('Bus status').selectOption('DELAYED');
    await status.getByLabel('Note for parents').fill('About 20 minutes late: traffic at Madhuban Chowk');
    await status.getByRole('button', { name: 'Update status' }).click();
    await expect(page.getByText('E2E Route 7: delayed').first()).toBeVisible();

    const context = await browser.newContext();
    const parent = await context.newPage();
    await signIn(parent, 'parent');
    const bus = parent.locator('[aria-labelledby="bus-heading"]');
    await expect(bus).toContainText('Delayed');
    await expect(bus).toContainText('About 20 minutes late: traffic at Madhuban Chowk');
    await expect(bus).toContainText('E2E Rohini East');
    await context.close();
  });

  test('taking a student off transport keeps only months already started', async ({ page, browser }) => {
    const f = fixtures();
    await signIn(page, 'adminA');
    await page.goto(TRANSPORT);
    await page.getByRole('button', { name: 'Remove E2E Family Student from transport' }).click();
    await expect(page.getByText('E2E Family Student taken off transport').first()).toBeVisible();

    await eventually(async () => (await transportCharges(f.familyStudent)).map((charge) => charge.amount), [1500]);
    await expect(riderRow(page)).toHaveCount(0);

    const context = await browser.newContext();
    const parent = await context.newPage();
    await signIn(parent, 'parent');
    await expect(parent.locator('[aria-labelledby="bus-heading"]')).toHaveCount(0);
    await context.close();
  });
});
