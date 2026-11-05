import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { Database } from '@/types/database';
import { checkRateLimit, rateLimitRuleFor } from '@/lib/edge-rate-limit';

const PROTECTED_SEGMENTS = ['/admin', '/teacher', '/portal'];

/**
 * Sent on every response the middleware produces, redirects and 429s
 * included. Razorpay Checkout opens in its own frame and popup, so payment is
 * allowed for its origins and popups keep their opener.
 */
const SECURITY_HEADERS: Record<string, string> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), usb=(), payment=(self "https://checkout.razorpay.com" "https://api.razorpay.com")',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
};

function secure(response: NextResponse, request: NextRequest): NextResponse {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  // Only over HTTPS: HSTS on a plain-HTTP localhost would be meaningless.
  const https = request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  if (https) response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  return response;
}

/**
 * The caller's address. On Vercel request.ip comes from the platform and
 * cannot be spoofed; behind another proxy the first X-Forwarded-For entry is
 * the client.
 */
function clientIp(request: NextRequest): string {
  const platform = (request as NextRequest & { ip?: string }).ip;
  if (platform) return platform;
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || 'unknown';
}

/**
 * Refreshes the Supabase session on every request so Server Components always
 * observe a valid JWT (including the school_id claim minted by the access
 * token hook), bounces anonymous users away from tenant-internal routes,
 * rate-limits the sensitive API routes, and sets the security headers.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: '', ...options, maxAge: 0 });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Signed-in callers are limited per account, everyone else per address.
  // Money routes count in Upstash; the rest in this instance's memory
  // (lib/edge-rate-limit.ts).
  const rule = rateLimitRuleFor(pathname);
  if (rule) {
    const decision = await checkRateLimit(user ? `user:${user.id}` : `ip:${clientIp(request)}`, rule);
    if (!decision.allowed) {
      const limited = NextResponse.json(
        { error: 'Too many requests. Please wait a moment and try again.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(decision.retryAfterSeconds),
            'X-RateLimit-Limit': String(decision.limit),
            'X-RateLimit-Remaining': '0',
          },
        },
      );
      return secure(limited, request);
    }
    response.headers.set('X-RateLimit-Limit', String(decision.limit));
    response.headers.set('X-RateLimit-Remaining', String(decision.remaining));
  }

  const needsAuth = PROTECTED_SEGMENTS.some((segment) => pathname.includes(segment));
  if (needsAuth && !user) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return secure(NextResponse.redirect(loginUrl), request);
  }

  return secure(response, request);
}

export const config = {
  matcher: [
    // Everything except static assets, image optimisation output, and the
    // Razorpay webhook (which authenticates by HMAC signature, not by cookie,
    // and must never be rate limited: the gateway retries until it gets a 2xx).
    '/((?!_next/static|_next/image|favicon.ico|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
