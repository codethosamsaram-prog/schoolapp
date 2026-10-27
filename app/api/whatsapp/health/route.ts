import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentProfile } from '@/lib/auth';
import { canManageSchool } from '@/lib/auth-routes';
import { getWhatsAppHealth } from '@/lib/whatsapp-health';

/**
 * WhatsApp diagnostics for admins: credential presence and validity, and the
 * approval status of every template the app sends. `?fresh=1` skips the
 * five-minute cache, e.g. straight after a template is approved.
 *
 * The report names missing variables but never echoes their values.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const current = await getCurrentProfile();
  if (!current) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!canManageSchool(current.profile.role) || !current.profile.is_active) {
    return NextResponse.json({ error: 'Only a school admin can view this' }, { status: 403 });
  }

  const health = await getWhatsAppHealth({ fresh: request.nextUrl.searchParams.get('fresh') === '1' });

  return NextResponse.json(health, {
    status: 200,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
