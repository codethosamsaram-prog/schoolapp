/**
 * Environment access with fail-fast semantics.
 *
 * Server secrets are read lazily through requireEnv so that importing a module
 * never crashes the build on a machine that legitimately lacks, say, the
 * WhatsApp credentials. The failure surfaces at the call site instead.
 */

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable ${name}. Add it to .env.local (see .env.example).`,
    );
  }
  return value;
}

export function optionalEnv(name: string, fallback = ''): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : fallback;
}

export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  razorpayKeyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? '',
} as const;

export function appUrl(path = '/'): string {
  const base = publicEnv.appUrl.replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
