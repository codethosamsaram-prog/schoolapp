import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Ends the session. POST only, so a prefetched or crawled link can never sign
 * anyone out; 303 turns the form POST into a GET of the login page.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  await supabase.auth.signOut();

  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
