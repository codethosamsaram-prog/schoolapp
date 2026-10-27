import { expect, test } from '@playwright/test';
import { APP_PORT, TENANT_A } from './constants';
import { gateway, signIn } from './support';

/**
 * The dev server under test has Meta credentials pointing at the stand-in
 * gateway, whose template statuses each test sets.
 */

interface Health {
  configured: boolean;
  credentials: string;
  templatesVerified: boolean;
  remindersReady: boolean;
  templates: { name: string; status: string; detail?: string }[];
  issues: string[];
}

test.describe('WhatsApp health', () => {
  test.beforeEach(async ({ request }) => {
    await gateway.reset(request);
  });

  test('the health API reports each template and never echoes credentials', async ({ page, request }) => {
    await gateway.setTemplates(request, { student_absence_alert: 'PENDING', admission_enquiry_ack: null });
    await signIn(page, 'adminA');

    const response = await page.request.get('/api/whatsapp/health?fresh=1');
    expect(response.status()).toBe(200);
    const text = await response.text();
    expect(text).not.toContain('e2e-token');

    const health = JSON.parse(text) as Health;
    expect(health).toMatchObject({
      configured: true,
      credentials: 'valid',
      templatesVerified: true,
      remindersReady: true,
    });
    const status = Object.fromEntries(health.templates.map((t) => [t.name, t.status]));
    expect(status).toEqual({
      fee_due_reminder: 'APPROVED',
      fee_payment_confirmation: 'APPROVED',
      student_absence_alert: 'PENDING',
      admission_enquiry_ack: 'MISSING',
    });
    expect(health.issues.join(' ')).toContain('Absence alerts will not send');
  });

  test('only admins can read the health report', async ({ browser, playwright }) => {
    const anonymous = await playwright.request.newContext({ baseURL: `http://localhost:${APP_PORT}` });
    expect((await anonymous.get('/api/whatsapp/health')).status()).toBe(401);
    await anonymous.dispose();

    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, 'student');
    expect((await page.request.get('/api/whatsapp/health')).status()).toBe(403);
    await context.close();
  });

  test('the Fees page explains why reminders are off, and clears once fixed', async ({ page, request }) => {
    await gateway.setTemplates(request, { fee_due_reminder: 'REJECTED' });
    await signIn(page, 'adminA');
    await page.goto(`/${TENANT_A.slug}/admin/fees?whatsapp=recheck`);

    const banner = page.getByRole('alert').filter({ hasText: 'Fee reminders are turned off' });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Fee reminders will not send: template "fee_due_reminder" is rejected');
    await expect(banner.getByText('How to set up WhatsApp')).toBeVisible();

    await page.getByRole('button', { name: 'Send fee reminders' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('WhatsApp is not ready to send fee reminders')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Send \d+ reminder/ })).toBeDisabled();
    await page.keyboard.press('Escape');

    // Approve it at the provider, then re-check from the banner.
    await gateway.setTemplates(request, { fee_due_reminder: 'APPROVED' });
    await banner.getByRole('link', { name: 'Check again' }).click();
    await expect(page.getByText('Fee reminders are turned off')).toHaveCount(0);
    await expect(page.getByText('Some WhatsApp messages may not be delivered')).toHaveCount(0);

    await page.getByRole('button', { name: 'Send fee reminders' }).click();
    await expect(page.getByRole('dialog').getByText('WhatsApp is not ready')).toHaveCount(0);
  });
});
