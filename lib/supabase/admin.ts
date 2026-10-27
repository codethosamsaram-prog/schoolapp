import 'server-only';

import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { publicEnv, requireEnv } from '@/lib/env';

let cached: SupabaseClient<Database> | null = null;

/**
 * Service-role client. Bypasses RLS, so it is restricted to code paths that
 * have no user session and must still write: the Razorpay webhook, and the
 * public admission form (which needs to read the tenant before inserting),
 * plus the one admin action that creates parent auth users, which runs only
 * after requireTenantSession has confirmed a SCHOOL_ADMIN.
 *
 * Every call site is responsible for scoping its own queries by school_id.
 * Never import this into a Client Component.
 */
export function createAdminClient(): SupabaseClient<Database> {
  if (cached) return cached;

  cached = createSupabaseClient<Database>(
    publicEnv.supabaseUrl || requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
      global: { headers: { 'x-classroomos-client': 'service-role' } },
    },
  );

  return cached;
}
