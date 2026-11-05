import { expect, test, type Page } from '@playwright/test';
import { TENANT_A, USERS } from './constants';
import { fixtures, gateway, serviceDb, signIn, userDb } from './support';

/**
 * Portal notifications: rows reach an open portal live over Supabase Realtime,
 * drive the unread badge, and stay private. The send route writes them by
 * default and calls the WhatsApp API only for CRITICAL ones.
 */

const PORTAL = `/${TENANT_A.slug}/portal`;
const TITLE_PREFIX = 'E2E notice';

/** Resolves once this page's channel is listening, so an insert after it is truly live. */
function whenSubscribed(page: Page): Promise<void> {
  return new Promise((resolve) => {
    page.on('websocket', (socket) => {
      socket.on('framereceived', (frame) => {
        if (String(frame.payload).includes('Subscribed to PostgreSQL')) resolve();
      });
    });
  });
}

async function addNotification(userId: string, title: string, body = 'Details of the notice') {
  const { error } = await serviceDb()
    .from('notifications')
    .insert({ school_id: TENANT_A.id, user_id: userId, title, body, type: 'FEE' });
  if (error) throw new Error(error.message);
}

async function clearNotifications(userId: string) {
  await serviceDb().from('notifications').delete().eq('user_id', userId);
}

async function whatsappCalls(page: Page) {
  return (await gateway.calls(page.request)).filter((call) => call.path.endsWith('/messages'));
}

test.describe('in-app notifications', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async () => {
    await clearNotifications(fixtures().users.parent);
  });

  test('a new notification reaches an open portal without a reload', async ({ page }) => {
    const f = fixtures();
    const subscribed = whenSubscribed(page);
    await signIn(page, 'parent');
    await page.goto(PORTAL);
    await subscribed;

    const badge = page.getByTestId('unread-badge');
    await expect(badge).toHaveCount(0);

    await addNotification(f.users.parent, `${TITLE_PREFIX} one`);
    await expect(badge).toHaveText('1');
    await expect(page.getByText(`${TITLE_PREFIX} one`).first()).toBeVisible();

    await addNotification(f.users.parent, `${TITLE_PREFIX} two`);
    await expect(badge).toHaveText('2');

    // Someone else's notification never arrives here.
    await addNotification(f.users.teacher, `${TITLE_PREFIX} for the teacher`);
    await page.waitForTimeout(1500);
    await expect(badge).toHaveText('2');
    await expect(page.getByText(`${TITLE_PREFIX} for the teacher`)).toHaveCount(0);
    await clearNotifications(f.users.teacher);
  });

  test('a background tab raises a browser alert when alerts are on', async ({ page }) => {
    await page.addInitScript(() => {
      const alerts: string[] = [];
      Object.assign(window, { __alerts: alerts });
      class StubNotification {
        static permission = 'granted';
        constructor(title: string) {
          alerts.push(title);
        }
      }
      Object.assign(window, { Notification: StubNotification });
      Object.defineProperty(document, 'hidden', { get: () => true });
    });

    const subscribed = whenSubscribed(page);
    await signIn(page, 'parent');
    await page.goto(PORTAL);
    await subscribed;

    await addNotification(fixtures().users.parent, `${TITLE_PREFIX} alert`);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __alerts: string[] }).__alerts))
      .toEqual([`${TITLE_PREFIX} alert`]);
  });

  test('the notifications page lists them and marking read clears the badge', async ({ page }) => {
    const f = fixtures();
    await addNotification(f.users.parent, `${TITLE_PREFIX} to read`);

    await signIn(page, 'parent');
    await page.goto(PORTAL);
    await expect(page.getByTestId('unread-badge')).toHaveText('1');

    await page.getByRole('link', { name: /Notifications, 1 unread/ }).click();
    await page.waitForURL(`**${PORTAL}/notifications`);
    await expect(page.getByRole('list', { name: 'Notifications' })).toContainText(`${TITLE_PREFIX} to read`);

    await page.getByRole('button', { name: 'Mark all as read' }).click();
    await expect(page.getByTestId('unread-badge')).toHaveCount(0);
    await expect(page.getByText('You are all caught up.')).toBeVisible();

    const { data } = await serviceDb().from('notifications').select('is_read').eq('user_id', f.users.parent);
    expect(data).toEqual([{ is_read: true }]);
  });

  test('users read only their own, and can change nothing but the read flag', async () => {
    const f = fixtures();
    await addNotification(f.users.parent, `${TITLE_PREFIX} private`);
    await addNotification(f.users.teacher, `${TITLE_PREFIX} other`);

    const parentDb = await userDb(USERS.parent.email);
    const { data: visible } = await parentDb.from('notifications').select('title');
    expect(visible).toEqual([{ title: `${TITLE_PREFIX} private` }]);

    const { data: mine } = await parentDb.from('notifications').select('id').limit(1).single();
    const edit = await parentDb.from('notifications').update({ title: 'Tampered' }).eq('id', mine!.id);
    expect(edit.error?.code).toBe('42501');
    const insert = await parentDb
      .from('notifications')
      .insert({ school_id: TENANT_A.id, user_id: f.users.parent, title: 'Forged', body: 'x', type: 'FEE' });
    expect(insert.error?.code).toBe('42501');

    // Marking someone else's as read touches nothing.
    await parentDb.from('notifications').update({ is_read: true }).eq('user_id', f.users.teacher);
    const { data: other } = await serviceDb().from('notifications').select('is_read').eq('user_id', f.users.teacher);
    expect(other).toEqual([{ is_read: false }]);
    await clearNotifications(f.users.teacher);
  });

  test('a leave decision and an announcement notify the family', async () => {
    const f = fixtures();
    const parentDb = await userDb(USERS.parent.email);
    const adminDb = await userDb(USERS.adminA.email);

    const day = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
    const { data: leave, error: leaveError } = await parentDb
      .from('leave_requests')
      .insert({
        school_id: TENANT_A.id,
        applicant_kind: 'STUDENT',
        student_id: f.familyStudent,
        requested_by: f.users.parent,
        leave_type: 'CASUAL',
        start_date: day,
        end_date: day,
        reason: 'Notification test',
      })
      .select('id')
      .single();
    expect(leaveError).toBeNull();
    const { error: reviewError } = await adminDb.from('leave_requests').update({ status: 'REJECTED' }).eq('id', leave!.id);
    expect(reviewError).toBeNull();

    const announcement = `${TITLE_PREFIX} annual day`;
    const { error: announceError } = await serviceDb()
      .from('announcements')
      .insert({ school_id: TENANT_A.id, title: announcement, content: 'On Friday.', target_type: 'SECTION', target_grade: 'IX', target_section: 'A' });
    expect(announceError).toBeNull();

    const { data } = await parentDb.from('notifications').select('title, type').order('created_at');
    expect(data).toEqual([
      { title: 'Leave rejected', type: 'LEAVE' },
      { title: announcement, type: 'ANNOUNCEMENT' },
    ]);

    // The leave spec lists this family's applications, so leave none behind.
    await serviceDb().from('leave_requests').delete().eq('id', leave!.id);
    await serviceDb().from('announcements').delete().eq('school_id', TENANT_A.id).eq('title', announcement);
    await serviceDb().from('notifications').delete().eq('school_id', TENANT_A.id).eq('title', announcement);
  });

  test('the send route stays in-app unless CRITICAL, and is for staff only', async ({ page, browser }) => {
    const f = fixtures();
    await gateway.reset(page.request);
    await signIn(page, 'adminA');
    const send = (data: Record<string, unknown>) => page.request.post('/api/whatsapp/send', { data });
    const notice = { studentId: f.familyStudent, title: `${TITLE_PREFIX} fee`, body: 'Fees are due', type: 'FEE' };

    const routine = await send(notice);
    expect(routine.status()).toBe(200);
    expect(await routine.json()).toEqual({ inApp: 1, whatsapp: { attempted: false, ok: false } });
    expect(await whatsappCalls(page)).toHaveLength(0);

    // A CRITICAL type with no approved template stays in-app too.
    const leave = await send({ ...notice, type: 'LEAVE', priority: 'CRITICAL' });
    expect((await leave.json()).whatsapp.attempted).toBe(false);
    expect(await whatsappCalls(page)).toHaveLength(0);

    const critical = await send({ ...notice, priority: 'CRITICAL' });
    expect(await critical.json()).toEqual({ inApp: 1, whatsapp: { attempted: true, ok: true } });
    expect(await whatsappCalls(page)).toHaveLength(1);

    expect((await send({ ...notice, type: 'SPAM' })).status()).toBe(400);

    const { count } = await serviceDb()
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', f.users.parent);
    expect(count).toBe(3);

    const parentContext = await browser.newContext();
    const parent = await parentContext.newPage();
    await signIn(parent, 'parent');
    expect((await parent.request.post('/api/whatsapp/send', { data: notice })).status()).toBe(403);
    await parentContext.close();

    // Another school's admin cannot see the student.
    const adminBContext = await browser.newContext();
    const adminB = await adminBContext.newPage();
    await signIn(adminB, 'adminB');
    expect((await adminB.request.post('/api/whatsapp/send', { data: notice })).status()).toBe(404);
    await adminBContext.close();
  });
});
