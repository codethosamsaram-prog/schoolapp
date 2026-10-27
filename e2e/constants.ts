/**
 * Values shared by playwright.config.ts, the global setup and the specs.
 * None of these are real credentials: they only mean something to the local
 * Supabase stack and to e2e/mock-gateway.mjs.
 */

export const APP_PORT = 3100;
export const MOCK_PORT = 3199;
export const MOCK_GATEWAY_URL = `http://127.0.0.1:${MOCK_PORT}`;

export const E2E_RAZORPAY_KEY_ID = 'rzp_test_e2e';
export const E2E_WEBHOOK_SECRET = 'e2e_webhook_secret';

export const TENANT_A = { id: '11111111-1111-4111-8111-111111111111', slug: 'demo-public-school' };
export const TENANT_B = { id: '22222222-2222-4222-8222-222222222222', slug: 'sri-chaitanya-jc' };

export const E2E_PASSWORD = 'E2e-Passw0rd!';

export const USERS = {
  adminA: { email: 'e2e-admin-a@classroomos.test', role: 'SCHOOL_ADMIN', tenant: TENANT_A },
  adminB: { email: 'e2e-admin-b@classroomos.test', role: 'SCHOOL_ADMIN', tenant: TENANT_B },
  student: { usn: 'E2E-STU-01', role: 'STUDENT', tenant: TENANT_A },
  parent: { email: 'e2e-parent@classroomos.test', role: 'PARENT', tenant: TENANT_A },
  teacher: { email: 'e2e-teacher@classroomos.test', role: 'TEACHER', tenant: TENANT_A },
} as const;

/** Every fixture row carries this, so setup can find and reset its own data. */
export const E2E_PREFIX = 'E2E';
