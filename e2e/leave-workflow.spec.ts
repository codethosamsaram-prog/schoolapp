import { expect, test } from '@playwright/test';
import { TENANT_A, USERS } from './constants';
import { fixtures, serviceDb, signIn, userDb } from './support';
import { todayInIST } from '../lib/utils';

/**
 * Leave from application to attendance. The steps build on each other: a
 * parent applies, an admin approves, attendance follows; then rejection by a
 * teacher, staff leave, and withdrawal.
 */

function shift(day: string, days: number): string {
  const value = new Date(`${day}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

// Monday to Wednesday of last week: in the past, never a Sunday.
const today = todayInIST();
const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
const MONDAY = shift(today, -weekday - 7);
const TUESDAY = shift(MONDAY, 1);
const WEDNESDAY = shift(MONDAY, 2);
// A future weekday for the application a teacher rejects.
const FUTURE_DAY = shift(today, 14 - weekday + 1); // a Tuesday two weeks on

async function attendanceFor(studentId: string, from: string, to: string) {
  const { data } = await serviceDb()
    .from('attendance')
    .select('date, status')
    .eq('student_id', studentId)
    .gte('date', from)
    .lte('date', to)
    .order('date');
  return Object.fromEntries((data ?? []).map((row) => [row.date, row.status]));
}

async function leaveRow(where: { student?: string; staff?: string; start: string }) {
  let query = serviceDb().from('leave_requests').select('id, status, review_note, reviewed_by').eq('start_date', where.start);
  query = where.student ? query.eq('student_id', where.student) : query.eq('staff_user_id', where.staff!);
  const { data } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
  return data;
}

test.describe('leave workflow', () => {
  test.describe.configure({ mode: 'serial' });

  test('a parent applies for sick leave; bad and overlapping applications are refused', async ({ page }) => {
    const f = fixtures();
    // What the class teacher marked on those days.
    await serviceDb()
      .from('attendance')
      .upsert(
        [
          { school_id: TENANT_A.id, student_id: f.familyStudent, date: MONDAY, status: 'ABSENT' as const },
          { school_id: TENANT_A.id, student_id: f.familyStudent, date: TUESDAY, status: 'PRESENT' as const },
        ],
        { onConflict: 'student_id,date' },
      );

    await signIn(page, 'parent');
    await page.goto(`/${TENANT_A.slug}/portal/leave`);
    const form = page.getByRole('form', { name: 'Apply for leave' });
    await expect(form).toContainText('E2E Family Student, Class IX-A');

    // The last day before the first is refused.
    await form.getByLabel('Kind of leave').selectOption('SICK');
    await form.getByLabel('From').fill(WEDNESDAY);
    await form.getByLabel('To').fill(MONDAY);
    await form.getByLabel('Reason').fill('Fever; doctor advised rest.');
    await form.getByRole('button', { name: 'Submit application' }).click();
    await expect(form.getByText('The last day cannot be before the first')).toBeVisible();

    await form.getByLabel('From').fill(MONDAY);
    await form.getByLabel('To').fill(WEDNESDAY);
    await form.getByRole('button', { name: 'Submit application' }).click();
    await expect(page.getByText('Leave application submitted').first()).toBeVisible();

    const list = page.getByRole('listitem', { name: 'Sick leave for E2E Family Student' });
    await expect(list).toContainText('Pending');
    await expect(list).toContainText('3 days');
    expect((await leaveRow({ student: f.familyStudent, start: MONDAY }))?.status).toBe('PENDING');

    // The same days again overlap the pending application.
    await form.getByLabel('Kind of leave').selectOption('CASUAL');
    await form.getByLabel('From').fill(TUESDAY);
    await form.getByLabel('To').fill(TUESDAY);
    await form.getByLabel('Reason').fill('Family function');
    await form.getByRole('button', { name: 'Submit application' }).click();
    await expect(form.getByText('Overlaps another application')).toBeVisible();

    // A parent cannot apply for someone else's child, even directly.
    const parentDb = await userDb(USERS.parent.email);
    const foreign = await parentDb.from('leave_requests').insert({
      school_id: TENANT_A.id,
      applicant_kind: 'STUDENT',
      student_id: f.students.void,
      requested_by: f.users.parent,
      leave_type: 'SICK',
      start_date: MONDAY,
      end_date: MONDAY,
      reason: 'Not my child',
    });
    expect(foreign.error?.code).toBe('42501');
  });

  test('an admin approves it and attendance records the days as EXCUSED_ABSENT', async ({ page, browser }) => {
    const f = fixtures();
    const { data: holidays } = await serviceDb()
      .from('holiday_calendar')
      .select('date')
      .eq('school_id', TENANT_A.id)
      .eq('is_academic_holiday', true)
      .gte('date', MONDAY)
      .lte('date', WEDNESDAY);
    const holiday = new Set((holidays ?? []).map((row) => row.date));

    await signIn(page, 'adminA');
    await page.goto(`/${TENANT_A.slug}/admin/leave`);
    const row = page.getByRole('listitem', { name: 'Sick leave for E2E Family Student' });
    await row.getByRole('button', { name: 'Review leave for E2E Family Student' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Note to the applicant (optional)').fill('Get well soon');
    await dialog.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Leave approved').first()).toBeVisible();

    const leave = await leaveRow({ student: f.familyStudent, start: MONDAY });
    expect(leave).toMatchObject({ status: 'APPROVED', review_note: 'Get well soon' });
    expect(leave?.reviewed_by).toBeTruthy();

    // Monday was ABSENT and becomes excused; Tuesday stays PRESENT because the
    // student came; Wednesday had no mark and is excused. Holidays are skipped.
    const expected: Record<string, string> = { [TUESDAY]: 'PRESENT' };
    for (const day of [MONDAY, WEDNESDAY]) if (!holiday.has(day)) expected[day] = 'EXCUSED_ABSENT';
    if (holiday.has(MONDAY)) expected[MONDAY] = 'ABSENT';
    expect(await attendanceFor(f.familyStudent, MONDAY, WEDNESDAY)).toEqual(expected);

    // The teacher's register shows the student as on leave rather than asking again.
    const teacherContext = await browser.newContext();
    const teacher = await teacherContext.newPage();
    await signIn(teacher, 'teacher');
    await teacher.goto(`/${TENANT_A.slug}/teacher/attendance?grade=IX&section=A&date=${WEDNESDAY}&view=list`);
    if (!holiday.has(WEDNESDAY)) {
      await expect(teacher.getByLabel('On approved leave')).toContainText('E2E Family Student');
    }
    await teacherContext.close();

    // The parent sees the decision and the note.
    const parentContext = await browser.newContext();
    const parent = await parentContext.newPage();
    await signIn(parent, 'parent');
    await parent.goto(`/${TENANT_A.slug}/portal/leave`);
    const mine = parent.getByRole('listitem', { name: 'Sick leave for E2E Family Student' });
    await expect(mine).toContainText('Approved');
    await expect(mine).toContainText('Get well soon');
    await expect(mine.getByRole('button', { name: 'Withdraw' })).toHaveCount(0);
    await parentContext.close();
  });

  test('a teacher rejects a student application, which leaves attendance untouched', async ({ page, browser }) => {
    const f = fixtures();
    const parentContext = await browser.newContext();
    const parent = await parentContext.newPage();
    await signIn(parent, 'parent');
    await parent.goto(`/${TENANT_A.slug}/portal/leave`);
    const form = parent.getByRole('form', { name: 'Apply for leave' });
    await form.getByLabel('Kind of leave').selectOption('CASUAL');
    await form.getByLabel('From').fill(FUTURE_DAY);
    await form.getByLabel('To').fill(FUTURE_DAY);
    await form.getByLabel('Reason').fill('Cousin’s wedding');
    await form.getByRole('button', { name: 'Submit application' }).click();
    await expect(parent.getByText('Leave application submitted').first()).toBeVisible();

    await signIn(page, 'teacher');
    await page.goto(`/${TENANT_A.slug}/teacher/leave`);
    await page.getByRole('button', { name: 'Review leave for E2E Family Student' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Note to the applicant (optional)').fill('Exams that week');
    await dialog.getByRole('button', { name: 'Reject' }).click();
    await expect(page.getByText('Leave rejected').first()).toBeVisible();

    expect(await leaveRow({ student: f.familyStudent, start: FUTURE_DAY })).toMatchObject({
      status: 'REJECTED',
      review_note: 'Exams that week',
    });
    expect(await attendanceFor(f.familyStudent, FUTURE_DAY, FUTURE_DAY)).toEqual({});

    await parent.reload();
    const rejected = parent.getByRole('listitem', { name: 'Casual leave for E2E Family Student' });
    await expect(rejected).toContainText('Rejected');
    await expect(rejected).toContainText('Exams that week');
    await parentContext.close();

    // A decision is final.
    const teacherDb = await userDb(USERS.teacher.email);
    const leave = await leaveRow({ student: f.familyStudent, start: FUTURE_DAY });
    const flip = await teacherDb.from('leave_requests').update({ status: 'APPROVED' }).eq('id', leave!.id).select('id');
    expect(flip.error?.message).toContain('already been rejected');
  });

  test('staff apply for their own leave; only an admin can approve it, and never themselves', async ({ page, browser }) => {
    const f = fixtures();
    await signIn(page, 'teacher');
    await page.goto(`/${TENANT_A.slug}/teacher/leave`);
    const form = page.getByRole('form', { name: 'Apply for leave' });
    await form.getByLabel('Kind of leave').selectOption('EMERGENCY');
    await form.getByLabel('From').fill(FUTURE_DAY);
    await form.getByLabel('To').fill(shift(FUTURE_DAY, 1));
    await form.getByLabel('Reason').fill('Family emergency in Jaipur');
    await form.getByRole('button', { name: 'Submit application' }).click();
    await expect(page.getByText('Leave application submitted').first()).toBeVisible();

    // No review button on one's own application, and the database refuses it too.
    const own = page.getByRole('listitem', { name: 'Emergency leave for E2E Teacher' });
    await expect(own).toContainText('Pending');
    await expect(own.getByRole('button', { name: /Review/ })).toHaveCount(0);
    const leave = await leaveRow({ staff: f.users.teacher, start: FUTURE_DAY });
    const teacherDb = await userDb(USERS.teacher.email);
    const self = await teacherDb.from('leave_requests').update({ status: 'APPROVED' }).eq('id', leave!.id).select('id');
    expect(self.error?.message).toContain('cannot review your own');

    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await signIn(admin, 'adminA');
    await admin.goto(`/${TENANT_A.slug}/admin/leave?status=PENDING&kind=STAFF`);
    await admin.getByRole('button', { name: 'Review leave for E2E Teacher' }).click();
    await admin.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
    await expect(admin.getByText('Leave approved').first()).toBeVisible();
    await adminContext.close();

    expect((await leaveRow({ staff: f.users.teacher, start: FUTURE_DAY }))?.status).toBe('APPROVED');
  });

  test('an applicant can withdraw a pending application; other schools see nothing', async ({ page }) => {
    const f = fixtures();
    await signIn(page, 'parent');
    await page.goto(`/${TENANT_A.slug}/portal/leave`);
    const later = shift(FUTURE_DAY, 7);
    const form = page.getByRole('form', { name: 'Apply for leave' });
    await form.getByLabel('Kind of leave').selectOption('CASUAL');
    await form.getByLabel('From').fill(later);
    await form.getByLabel('To').fill(later);
    await form.getByLabel('Reason').fill('Dentist appointment');
    await form.getByRole('button', { name: 'Submit application' }).click();
    await expect(page.getByText('Leave application submitted').first()).toBeVisible();

    const item = page.getByRole('listitem').filter({ hasText: 'Dentist appointment' });
    await item.getByRole('button', { name: 'Withdraw' }).click();
    await expect(item).toContainText('Cancelled');
    expect((await leaveRow({ student: f.familyStudent, start: later }))?.status).toBe('CANCELLED');

    const adminB = await userDb(USERS.adminB.email);
    expect((await adminB.from('leave_requests').select('id').eq('school_id', TENANT_A.id)).data).toEqual([]);
  });
});
