#!/usr/bin/env node
/**
 * Pre-flight environment check for ClassroomOS.
 *
 *   node scripts/check-env.mjs                     report on the current environment
 *   node scripts/check-env.mjs --production        fail (exit 1) on anything unsafe
 *   node scripts/check-env.mjs --file .env.prod    check a file instead of process.env
 *
 * Wired up as `prebuild`: on a Vercel production build (VERCEL_ENV=production),
 * or with CLASSROOMOS_ENV=production, it runs in production mode and stops
 * the build on errors. Everywhere else it reports and exits 0, so local and
 * preview builds keep working without payment or WhatsApp credentials.
 *
 * Values are never printed, only variable names and what is wrong with them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;
const production =
  args.includes('--production') ||
  process.env.VERCEL_ENV === 'production' ||
  process.env.CLASSROOMOS_ENV === 'production';

/* ------------------------------------------------------------ load values */

function parseEnvFile(file) {
  const values = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    values[match[1]] = value;
  }
  return values;
}

let env;
let source;
if (fileArg) {
  const file = path.resolve(ROOT, fileArg);
  if (!fs.existsSync(file)) {
    console.error(`check-env: ${fileArg} does not exist.`);
    process.exit(1);
  }
  env = parseEnvFile(file);
  source = fileArg;
} else {
  // Next loads .env.local at build time, so a local check should see it too.
  const local = path.join(ROOT, '.env.local');
  env = { ...(fs.existsSync(local) && !production ? parseEnvFile(local) : {}), ...process.env };
  source = production ? 'the process environment' : 'the process environment and .env.local';
}

const get = (name) => (env[name] ?? '').trim();

/* ---------------------------------------------------------------- checks */

const errors = [];
const warnings = [];
/** Missing configuration: blocks a production build, informs a local one. */
const problem = (message) => (production ? errors : warnings).push(message);
/** Unsafe for production, expected locally (http, localhost, demo keys). */
const productionOnly = (message) => {
  if (production) errors.push(message);
};

const REQUIRED = [
  ['NEXT_PUBLIC_SUPABASE_URL', 'Supabase project URL'],
  ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'Supabase anon (public) key'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'Supabase service role key'],
  ['NEXT_PUBLIC_APP_URL', 'public origin, used in receipt links'],
  ['RECEIPT_TOKEN_SECRET', 'HMAC key for signed receipt links'],
  ['RAZORPAY_KEY_ID', 'Razorpay key id'],
  ['RAZORPAY_KEY_SECRET', 'Razorpay key secret'],
  ['RAZORPAY_WEBHOOK_SECRET', 'Razorpay webhook secret'],
];

const whatsappProvider = get('WHATSAPP_PROVIDER') || 'meta';
if (whatsappProvider === 'interakt') {
  REQUIRED.push(['INTERAKT_API_KEY', 'Interakt API key']);
} else {
  REQUIRED.push(
    ['WHATSAPP_PHONE_NUMBER_ID', 'WhatsApp phone number id'],
    ['WHATSAPP_ACCESS_TOKEN', 'WhatsApp access token'],
  );
}

for (const [name, purpose] of REQUIRED) {
  if (!get(name)) problem(`${name} is not set (${purpose}).`);
}

// Values copied from .env.example or used by the local stack and the tests.
const PLACEHOLDER = /(^|[^a-z])(x{6,}|change-?me|your[-_]|placeholder|example|e2e[-_]|dummy)|\.\.\.$/i;
for (const [name] of REQUIRED) {
  if (get(name) && PLACEHOLDER.test(get(name))) productionOnly(`${name} still holds a placeholder or test value.`);
}

/** JWT payload without verifying it: enough to spot keys for the wrong project or role. */
function jwtClaims(token) {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function checkSupabaseKey(name, role) {
  const key = get(name);
  if (!key) return;
  if (key.startsWith('sb_publishable_') || key.startsWith('sb_secret_')) {
    const expected = role === 'anon' ? 'sb_publishable_' : 'sb_secret_';
    if (!key.startsWith(expected)) problem(`${name} is a ${key.split('_')[1]} key; expected ${expected}…`);
    return;
  }
  const claims = jwtClaims(key);
  if (!claims) {
    problem(`${name} is not a Supabase key (neither a JWT nor sb_… format).`);
    return;
  }
  if (claims.iss === 'supabase-demo') {
    productionOnly(`${name} is the well-known local development key from \`supabase start\`.`);
  }
  if (claims.role !== role) problem(`${name} has role "${claims.role}"; expected "${role}".`);
}
checkSupabaseKey('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
checkSupabaseKey('SUPABASE_SERVICE_ROLE_KEY', 'service_role');
if (get('SUPABASE_SERVICE_ROLE_KEY') && get('SUPABASE_SERVICE_ROLE_KEY') === get('NEXT_PUBLIC_SUPABASE_ANON_KEY')) {
  errors.push('SUPABASE_SERVICE_ROLE_KEY is the same as the anon key.');
}

// The service role key bypasses RLS; it must never be exposed to the browser.
for (const name of Object.keys(env)) {
  if (name.startsWith('NEXT_PUBLIC_') && /SERVICE_ROLE|SECRET|TOKEN|PASSWORD/i.test(name)) {
    errors.push(`${name} would be bundled into the browser; secrets must not use the NEXT_PUBLIC_ prefix.`);
  }
}

const LOCAL_JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
for (const name of ['SUPABASE_JWT_SECRET', 'JWT_SECRET']) {
  if (get(name) === LOCAL_JWT_SECRET) productionOnly(`${name} is the default local development JWT secret.`);
}

for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_APP_URL']) {
  const value = get(name);
  if (!value) continue;
  let url;
  try {
    url = new URL(value);
  } catch {
    errors.push(`${name} is not a valid URL.`);
    continue;
  }
  if (url.protocol !== 'https:') productionOnly(`${name} uses ${url.protocol.replace(':', '')}; production must use https.`);
  if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url.hostname) || url.hostname.endsWith('.local')) {
    productionOnly(`${name} points at a local host (${url.hostname}).`);
  }
}

const receiptSecret = get('RECEIPT_TOKEN_SECRET');
if (receiptSecret && receiptSecret.length < 32) {
  productionOnly('RECEIPT_TOKEN_SECRET is shorter than 32 characters; generate one with `openssl rand -hex 32`.');
}
if (receiptSecret && receiptSecret === get('RAZORPAY_WEBHOOK_SECRET')) {
  problem('RECEIPT_TOKEN_SECRET reuses the Razorpay webhook secret; give each purpose its own key.');
}

if (production && /^rzp_test_/.test(get('RAZORPAY_KEY_ID'))) {
  warnings.push('RAZORPAY_KEY_ID is a test-mode key; parents cannot make real payments.');
}
if (get('NEXT_PUBLIC_RAZORPAY_KEY_ID') && get('NEXT_PUBLIC_RAZORPAY_KEY_ID') !== get('RAZORPAY_KEY_ID')) {
  problem('NEXT_PUBLIC_RAZORPAY_KEY_ID does not match RAZORPAY_KEY_ID; Checkout would open for another account.');
}
if (whatsappProvider === 'meta' && get('WHATSAPP_ACCESS_TOKEN') && !get('WHATSAPP_BUSINESS_ACCOUNT_ID')) {
  warnings.push('WHATSAPP_BUSINESS_ACCOUNT_ID is not set, so the health check cannot confirm template approval.');
}

// Switches that only the e2e suite may use.
for (const name of ['RAZORPAY_API_BASE_URL', 'WHATSAPP_GRAPH_BASE_URL', 'NEXT_DIST_DIR']) {
  if (get(name)) problem(`${name} is a test-only override and must not be set outside the e2e suite.`);
}

if (production && !(get('UPSTASH_REDIS_REST_URL') && get('UPSTASH_REDIS_REST_TOKEN'))) {
  warnings.push(
    'UPSTASH_REDIS_REST_URL/TOKEN are not set; API rate limits fall back to per-instance memory, which each serverless instance counts separately.',
  );
}

/* ---------------------------------------------------------------- report */

const mode = production ? 'production' : 'development';
console.log(`check-env: ${mode} checks on ${source}`);
for (const message of errors) console.log(`  ✗ ${message}`);
for (const message of warnings) console.log(`  ! ${message}`);

if (errors.length) {
  console.log(`check-env: ${errors.length} error(s). Fix them before deploying.`);
  process.exit(1);
}
console.log(
  warnings.length
    ? `check-env: no blocking errors, ${warnings.length} warning(s)${production ? '' : ' (fine for local development)'}.`
    : 'check-env: all good.',
);
