import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { Database } from '../types/database';
import { studentLoginEmail } from '../lib/auth-routes';
import {
  E2E_PASSWORD,
  E2E_WEBHOOK_SECRET,
  MOCK_GATEWAY_URL,
  USERS,
} from './constants';

export { formatINR } from '../lib/utils';

const ROOT = path.resolve(__dirname, '..');
const FIXTURES_FILE = path.join(__dirname, '.fixtures.json');

/** .env.local values, overridden by the real environment. */
function env(name: string): string {
  if (process.env[name]) return process.env[name] as string;
  const file = path.join(ROOT, '.env.local');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && match[1] === name) return match[2].replace(/^["']|["']$/g, '');
    }
  }
  throw new Error(`${name} is not set; the e2e suite reads it from .env.local.`);
}

export const supabaseUrl = () => env('NEXT_PUBLIC_SUPABASE_URL');
export const anonKey = () => env('NEXT_PUBLIC_SUPABASE_ANON_KEY');

/** Service-role client: bypasses RLS, for fixtures and ground-truth reads. */
export function serviceDb(): SupabaseClient<Database> {
  return createClient<Database>(supabaseUrl(), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A client signed in as a real user, so every query goes through RLS. */
export async function userDb(email: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(supabaseUrl(), env('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: E2E_PASSWORD });
  if (error) throw new Error(`Could not sign in as ${email}: ${error.message}`);
  return client;
}

export const studentEmail = () => studentLoginEmail(USERS.student.tenant.slug, USERS.student.usn);

export interface Fixtures {
  students: {
    lifecycle: string;
    void: string;
    refund: string;
    portal: string;
  };
  refundPaymentId: string;
  refundPaymentAmount: number;
  declinedPaymentId: string;
  tenantBStudentId: string;
  tenantBStudentName: string;
  tenantBPaymentId: string;
  portalExam: string;
  portalSyllabusSubject: string;
  staff: { teacher: string; accountant: string };
  familyStudent: string;
  transport: { routeId: string; marketStop: string; eastStop: string };
  users: { parent: string; teacher: string };
}

export function writeFixtures(fixtures: Fixtures) {
  fs.writeFileSync(FIXTURES_FILE, JSON.stringify(fixtures, null, 2));
}

export function fixtures(): Fixtures {
  return JSON.parse(fs.readFileSync(FIXTURES_FILE, 'utf8')) as Fixtures;
}

/** Signs in through the real login form and waits for the role's home page. */
export async function signIn(page: Page, who: keyof typeof USERS) {
  const user = USERS[who];
  const family = who === 'student' || who === 'parent';
  const identifier = who === 'student' ? USERS.student.usn : USERS[who].email;
  await page.goto(`/login?role=${family ? 'student' : 'staff'}&school=${user.tenant.slug}`);
  await page.fill('input[name=identifier]', identifier);
  await page.fill('input[name=password]', E2E_PASSWORD);
  await page.click('button[type=submit]');
  const home = family ? 'portal' : who === 'teacher' ? 'teacher' : 'admin';
  await page.waitForURL(`**/${user.tenant.slug}/${home}**`);
}

export async function studentRow(id: string) {
  const { data, error } = await serviceDb()
    .from('students')
    .select('full_name, class_grade, section, parent_name, parent_phone, total_fee_due, current_balance')
    .eq('id', id)
    .single();
  if (error || !data) throw new Error(`fixture student ${id} is missing`);
  return { ...data, total_fee_due: Number(data.total_fee_due), current_balance: Number(data.current_balance) };
}

export async function paymentRow(id: string) {
  const { data, error } = await serviceDb()
    .from('fee_payments')
    .select('status, amount_paid, amount_refunded, void_reason')
    .eq('id', id)
    .single();
  if (error || !data) throw new Error(`payment ${id} is missing`);
  return { ...data, amount_paid: Number(data.amount_paid), amount_refunded: Number(data.amount_refunded) };
}

/** Sum of a class's fee heads for the current year: what a student there owes. */
export async function classDues(schoolId: string, grade: string): Promise<number> {
  const db = serviceDb();
  const { data: year } = await db.rpc('current_academic_year');
  const { data } = await db
    .from('fee_structures')
    .select('amount')
    .eq('school_id', schoolId)
    .eq('class_grade', grade)
    .eq('academic_year', year ?? '')
    .is('student_id', null);
  return (data ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
}

/* ------------------------------------------------------------ mock gateway */

export interface GatewayCall {
  method: string;
  path: string;
  query: string;
  body: unknown;
}

export const gateway = {
  async reset(request: APIRequestContext) {
    await request.post(`${MOCK_GATEWAY_URL}/__reset`);
  },
  async calls(request: APIRequestContext): Promise<GatewayCall[]> {
    return (await request.get(`${MOCK_GATEWAY_URL}/__requests`)).json();
  },
  async setTemplates(request: APIRequestContext, statuses: Record<string, string | null>) {
    await request.put(`${MOCK_GATEWAY_URL}/__templates`, { data: statuses });
  },
};

/** Posts a Razorpay webhook with a valid signature, as the gateway would. */
export async function deliverWebhook(request: APIRequestContext, payload: unknown) {
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', E2E_WEBHOOK_SECRET).update(body).digest('hex');
  return request.post('/api/webhooks/razorpay', {
    data: body,
    headers: { 'Content-Type': 'application/json', 'x-razorpay-signature': signature },
  });
}

/** Waits until the DB agrees, since server actions revalidate asynchronously. */
export async function eventually<T>(read: () => Promise<T>, expected: T) {
  await expect.poll(read, { timeout: 15_000 }).toEqual(expected);
}
