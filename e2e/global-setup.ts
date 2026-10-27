import type { UserRole } from '../types/database';
import type { FullConfig } from '@playwright/test';
import {
  E2E_PASSWORD,
  E2E_PREFIX,
  TENANT_A,
  TENANT_B,
  USERS,
} from './constants';
import { serviceDb, studentEmail, supabaseUrl, writeFixtures, type Fixtures } from './support';

/**
 * Resets the suite's own fixtures before every run: the E2E logins, and in
 * tenant A a set of students whose admission numbers start with "E2E-".
 * Deleting those students cascades to their payments, refunds and results,
 * so each run starts from the same state. Seed data is never modified.
 */

const PORTAL_EXAM = `${E2E_PREFIX} Term Test`;
const PORTAL_SUBJECT = `${E2E_PREFIX} Science`;

// A one-page PDF, small enough to inline.
const SYLLABUS_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

export default async function globalSetup(_config: FullConfig) {
  await assertStackRunning();
  const db = serviceDb();

  const [, , studentUser, parentUser, teacherUser] = await Promise.all([
    ensureUser(USERS.adminA.email, { role: 'SCHOOL_ADMIN', school_id: TENANT_A.id }, 'E2E Admin A'),
    ensureUser(USERS.adminB.email, { role: 'SCHOOL_ADMIN', school_id: TENANT_B.id }, 'E2E Admin B'),
    ensureUser(studentEmail(), { role: 'STUDENT', school_id: TENANT_A.id }, 'E2E Portal Student'),
    ensureUser(USERS.parent.email, { role: 'PARENT', school_id: TENANT_A.id }, 'E2E Parent'),
    ensureUser(USERS.teacher.email, { role: 'TEACHER', school_id: TENANT_A.id }, 'E2E Teacher'),
  ]);

  // 1. Clear the previous run.
  must(
    await db.from('students').delete().eq('school_id', TENANT_A.id).like('admission_number', `${E2E_PREFIX}-%`),
    'clear E2E students',
  );
  // Staff leave and E2E bus routes; student leave, allocations and transport
  // fees go with the students above.
  must(await db.from('leave_requests').delete().eq('staff_user_id', teacherUser), 'clear staff leave');
  must(
    await db.from('transport_routes').delete().eq('school_id', TENANT_A.id).like('name', `${E2E_PREFIX} %`),
    'clear E2E routes',
  );
  must(await db.from('syllabus_copies').delete().eq('school_id', TENANT_A.id).eq('subject', PORTAL_SUBJECT), 'clear syllabus');
  must(
    await db.from('fee_payments').delete().eq('school_id', TENANT_B.id).like('receipt_number', `${E2E_PREFIX}-%`),
    'clear tenant B payments',
  );

  // Staff: payslips first, since a payslip keeps its staff record alive.
  const { data: oldStaff } = await db
    .from('staff')
    .select('id')
    .eq('school_id', TENANT_A.id)
    .like('employee_code', `${E2E_PREFIX}-%`);
  const oldStaffIds = (oldStaff ?? []).map((row) => row.id);
  if (oldStaffIds.length) {
    must(await db.from('payslips').delete().in('staff_id', oldStaffIds), 'clear E2E payslips');
    must(await db.from('staff').delete().in('id', oldStaffIds), 'clear E2E staff');
  }

  // 2. Students, all in Class IX-A of tenant A.
  const base = {
    school_id: TENANT_A.id,
    class_grade: 'IX',
    section: 'A',
    parent_name: 'E2E Parent',
    parent_phone: '9810000000',
  };
  const inserted = must(
    await db
      .from('students')
      .insert([
        { ...base, full_name: 'E2E Lifecycle Student', roll_number: 'E2E-01', admission_number: 'E2E-LIFE' },
        { ...base, full_name: 'E2E Void Student', roll_number: 'E2E-02', admission_number: 'E2E-VOID' },
        { ...base, full_name: 'E2E Refund Student', roll_number: 'E2E-03', admission_number: 'E2E-REFUND' },
        {
          ...base,
          full_name: 'E2E Portal Student',
          roll_number: 'E2E-04',
          admission_number: 'E2E-PORTAL',
          usn: USERS.student.usn,
          user_id: studentUser,
          blood_group: 'B+',
        },
        {
          ...base,
          full_name: 'E2E Family Student',
          roll_number: 'E2E-05',
          admission_number: 'E2E-FAMILY',
          parent_user_id: parentUser,
        },
      ])
      .select('id, admission_number'),
    'insert students',
  );
  const idOf = (admission: string) => inserted.find((row) => row.admission_number === admission)!.id;

  // Dues follow the class schedule, exactly as enrolment sets them.
  must(await db.rpc('sync_class_dues', { target_school: TENANT_A.id, target_grade: 'IX' }), 'sync dues');

  // 3. Payments. Online ones look as the webhook leaves them.
  const stamp = Date.now();
  const paidAt = new Date().toISOString();
  const payments = must(
    await db
      .from('fee_payments')
      .insert([
        {
          school_id: TENANT_A.id,
          student_id: idOf('E2E-REFUND'),
          amount_paid: 10000,
          payment_method: 'UPI (e2e@okaxis)',
          razorpay_order_id: `order_E2E${stamp}`,
          razorpay_payment_id: `pay_E2E${stamp}`,
          status: 'SUCCESS',
          receipt_number: `${E2E_PREFIX}-R-${stamp}`,
          paid_at: paidAt,
        },
        {
          school_id: TENANT_A.id,
          student_id: idOf('E2E-REFUND'),
          amount_paid: 500,
          payment_method: 'Card',
          razorpay_order_id: `order_E2E_DECLINE${stamp}`,
          razorpay_payment_id: `pay_E2E_DECLINE${stamp}`,
          status: 'SUCCESS',
          receipt_number: `${E2E_PREFIX}-D-${stamp}`,
          paid_at: paidAt,
        },
        {
          school_id: TENANT_A.id,
          student_id: idOf('E2E-PORTAL'),
          amount_paid: 20000,
          payment_method: 'Cash',
          status: 'SUCCESS',
          receipt_number: `${E2E_PREFIX}-P-${stamp}`,
          paid_at: paidAt,
        },
      ])
      .select('id, razorpay_payment_id'),
    'insert payments',
  );

  // 4. Tenant B gets a payment of its own, so isolation checks are not vacuous.
  const tenantBStudent = must(
    await db
      .from('students')
      .select('id, full_name')
      .eq('school_id', TENANT_B.id)
      .eq('is_active', true)
      .limit(1)
      .single(),
    'find tenant B student',
  );
  const tenantBPayment = must(
    await db
      .from('fee_payments')
      .insert({
        school_id: TENANT_B.id,
        student_id: tenantBStudent.id,
        amount_paid: 1000,
        payment_method: 'Cash',
        status: 'SUCCESS',
        receipt_number: `${E2E_PREFIX}-B-${stamp}`,
        paid_at: paidAt,
      })
      .select('id')
      .single(),
    'insert tenant B payment',
  );

  // 5. Results and a syllabus copy for the student portal.
  must(
    await db.from('exam_results').insert(
      [
        ['Mathematics', 78],
        ['Science', 91],
        ['English', 30],
      ].map(([subject, marks]) => ({
        school_id: TENANT_A.id,
        student_id: idOf('E2E-PORTAL'),
        exam_name: PORTAL_EXAM,
        subject: String(subject),
        marks_obtained: Number(marks),
        max_marks: 100,
        entered_by: null,
      })),
    ),
    'insert results',
  );

  const syllabusPath = `${TENANT_A.id}/syllabus/e2e-science.pdf`;
  const upload = await db.storage
    .from('academic-docs')
    .upload(syllabusPath, SYLLABUS_PDF, { contentType: 'application/pdf', upsert: true });
  if (upload.error) throw new Error(`upload syllabus: ${upload.error.message}`);
  must(
    await db.from('syllabus_copies').insert({
      school_id: TENANT_A.id,
      class_grade: 'IX',
      subject: PORTAL_SUBJECT,
      pdf_url: syllabusPath,
      uploaded_by: null,
    }),
    'insert syllabus',
  );

  // 6. Staff on tenant A's payroll.
  const staff = must(
    await db
      .from('staff')
      .insert([
        {
          school_id: TENANT_A.id,
          employee_code: 'E2E-T1',
          full_name: 'E2E Payroll Teacher',
          staff_role: 'TEACHER',
          departments: ['Science'],
          base_salary: 45000,
          bank_name: 'State Bank of India',
          bank_account_last4: '4321',
        },
        {
          school_id: TENANT_A.id,
          employee_code: 'E2E-A1',
          full_name: 'E2E Accountant',
          staff_role: 'ACCOUNTANT',
          departments: ['Accounts'],
          base_salary: 38000,
        },
      ])
      .select('id, employee_code'),
    'insert staff',
  );
  const staffId = (code: string) => staff.find((row) => row.employee_code === code)!.id;

  // 7. A bus route with two stops.
  const route = must(
    await db
      .from('transport_routes')
      .insert({
        school_id: TENANT_A.id,
        name: `${E2E_PREFIX} Route 7`,
        vehicle_registration: 'DL 1P 7777',
        driver_name: 'Ramesh Kumar',
        driver_phone: '9811100007',
      })
      .select('id')
      .single(),
    'insert route',
  );
  const stops = must(
    await db
      .from('transport_stops')
      .insert([
        {
          school_id: TENANT_A.id,
          route_id: route.id,
          name: `${E2E_PREFIX} Sector 9 Market`,
          pickup_time: '07:10',
          drop_time: '14:40',
          monthly_fee: 1500,
          sequence: 1,
        },
        {
          school_id: TENANT_A.id,
          route_id: route.id,
          name: `${E2E_PREFIX} Rohini East`,
          pickup_time: '07:25',
          drop_time: '14:25',
          monthly_fee: 2000,
          sequence: 2,
        },
      ])
      .select('id, name'),
    'insert stops',
  );
  const stopId = (suffix: string) => stops.find((row) => row.name.endsWith(suffix))!.id;

  const fixtures: Fixtures = {
    students: {
      lifecycle: idOf('E2E-LIFE'),
      void: idOf('E2E-VOID'),
      refund: idOf('E2E-REFUND'),
      portal: idOf('E2E-PORTAL'),
    },
    refundPaymentId: payments.find((row) => row.razorpay_payment_id === `pay_E2E${stamp}`)!.id,
    refundPaymentAmount: 10000,
    declinedPaymentId: payments.find((row) => row.razorpay_payment_id === `pay_E2E_DECLINE${stamp}`)!.id,
    tenantBStudentId: tenantBStudent.id,
    tenantBStudentName: tenantBStudent.full_name,
    tenantBPaymentId: tenantBPayment.id,
    portalExam: PORTAL_EXAM,
    portalSyllabusSubject: PORTAL_SUBJECT,
    staff: { teacher: staffId('E2E-T1'), accountant: staffId('E2E-A1') },
    familyStudent: idOf('E2E-FAMILY'),
    transport: { routeId: route.id, marketStop: stopId('Sector 9 Market'), eastStop: stopId('Rohini East') },
    users: { parent: parentUser, teacher: teacherUser },
  };
  writeFixtures(fixtures);
}

async function assertStackRunning() {
  try {
    const response = await fetch(`${supabaseUrl()}/auth/v1/health`, { signal: AbortSignal.timeout(5000) });
    if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    throw new Error(
      `The local Supabase stack is not reachable at ${supabaseUrl()} (${
        error instanceof Error ? error.message : error
      }). Start it with \`npx supabase start\` and run the migrations first.`,
    );
  }
}

/**
 * Creates the login, or resets its password and tenant if it exists. The
 * profile comes from handle_new_user(), which reads app_metadata.
 */
async function ensureUser(
  email: string,
  appMetadata: { role: string; school_id: string },
  fullName: string,
): Promise<string> {
  const db = serviceDb();
  const { data: list, error: listError } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw new Error(`list users: ${listError.message}`);
  const existing = list.users.find((user) => user.email === email);

  let id: string;
  if (existing) {
    const { error } = await db.auth.admin.updateUserById(existing.id, {
      password: E2E_PASSWORD,
      app_metadata: appMetadata,
      email_confirm: true,
    });
    if (error) throw new Error(`update ${email}: ${error.message}`);
    id = existing.id;
  } else {
    const { data, error } = await db.auth.admin.createUser({
      email,
      password: E2E_PASSWORD,
      email_confirm: true,
      app_metadata: appMetadata,
      user_metadata: { full_name: fullName },
    });
    if (error || !data.user) throw new Error(`create ${email}: ${error?.message}`);
    id = data.user.id;
  }

  // A first-login password change would stop every test at the login form.
  must(
    await db
      .from('profiles')
      .update({
        role: appMetadata.role as UserRole,
        school_id: appMetadata.school_id,
        is_active: true,
        must_change_password: false,
        full_name: fullName,
      })
      .eq('id', id)
      .select('id')
      .single(),
    `profile for ${email}`,
  );
  return id;
}

function must<T>(result: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (result.error) throw new Error(`e2e setup could not ${what}: ${result.error.message}`);
  return result.data as NonNullable<T>;
}
