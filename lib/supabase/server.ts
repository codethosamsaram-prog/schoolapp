import 'server-only';

import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { Database } from '@/types/database';
import { publicEnv } from '@/lib/env';

/**
 * Request-scoped server client for Server Components, Server Actions and Route
 * Handlers. Reads and refreshes the session cookie; all queries run as the
 * signed-in user and are therefore constrained by RLS.
 */
export function createClient() {
  const cookieStore = cookies();

  return createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // middleware.ts refreshes the session, so this is safe to ignore.
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: '', ...options, maxAge: 0 });
        } catch {
          // See above.
        }
      },
    },
  });
}

/**
 * Anonymous client for public, unauthenticated surfaces (the school portal).
 * It sends no session cookie, so it sees only what the `anon` policies allow:
 * active schools, their fee schedules, and INSERT into admission_leads.
 */
export function createAnonClient(options: { fresh?: boolean } = {}) {
  return createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    // An anonymous GET has no session headers, so Next's data cache keeps it for
    // up to a year unless told otherwise. `fresh` is for data that must show edits.
    ...(options.fresh
      ? { global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, cache: 'no-store' }) } }
      : {}),
    cookies: {
      get() {
        return undefined;
      },
      set() {
        /* no session to persist */
      },
      remove() {
        /* no session to persist */
      },
    },
  });
}
