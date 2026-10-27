#!/usr/bin/env node
/**
 * Provisions a staff login. Public signups are disabled, and a profile's role
 * and tenant are only ever read from app_metadata, which needs the service
 * role, so this is how the first SCHOOL_ADMIN of a tenant gets in.
 *
 *   node --env-file=.env.local scripts/create-user.mjs \
 *     --email admin@school.in --password '...' --role SCHOOL_ADMIN \
 *     --school demo-public-school --name "Office Admin"
 *
 * Parents are provisioned from the admin console (Students -> Create parent login).
 */
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';

const ROLES = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER', 'PARENT', 'STUDENT'];

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    password: { type: 'string' },
    role: { type: 'string', default: 'SCHOOL_ADMIN' },
    school: { type: 'string' },
    name: { type: 'string', default: '' },
  },
});

function fail(message) {
  console.error(`create-user: ${message}`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) fail('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
if (!values.email || !values.password) fail('--email and --password are required');
if (values.password.length < 8) fail('--password must be at least 8 characters');
if (!ROLES.includes(values.role)) fail(`--role must be one of ${ROLES.join(', ')}`);
if (values.role !== 'SUPER_ADMIN' && !values.school) fail('--school <slug> is required for this role');

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

let schoolId = null;
if (values.school) {
  const { data, error } = await admin.from('schools').select('id').eq('slug', values.school).maybeSingle();
  if (error || !data) fail(`no school with slug "${values.school}"`);
  schoolId = data.id;
}

const { data, error } = await admin.auth.admin.createUser({
  email: values.email,
  password: values.password,
  email_confirm: true,
  app_metadata: { role: values.role, ...(schoolId ? { school_id: schoolId } : {}) },
  user_metadata: { full_name: values.name },
});

if (error) fail(error.message);
console.log(`Created ${values.role} ${values.email} (${data.user.id})`);
