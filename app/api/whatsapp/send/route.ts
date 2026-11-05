import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getCurrentProfile } from '@/lib/auth';
import { isStaff } from '@/lib/auth-routes';
import { notifyFamily, type FamilyNotification } from '@/lib/notifications';
import { createClient } from '@/lib/supabase/server';
import { formatDate, formatINR, todayInIST } from '@/lib/utils';
import { sendAbsenceAlert, sendFeeDueReminder } from '@/lib/whatsapp';

/**
 * Staff send a notification to one student's family. It is always written to
 * the in-app `notifications` ledger. The paid WhatsApp API is called only when
 * priority is CRITICAL, and only for types with an approved template: WhatsApp
 * refuses free text outside a template.
 *
 * Runs on the caller's session, so RLS decides which students they can reach.
 * Rate limited with the other /api/whatsapp/ routes in middleware.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  studentId: z.string().uuid(),
  title: z.string().trim().min(1).max(150),
  body: z.string().trim().min(1).max(1000),
  type: z.enum(['FEE', 'LEAVE', 'ATTENDANCE', 'ANNOUNCEMENT']),
  priority: z.enum(['ROUTINE', 'CRITICAL']).default('ROUTINE'),
});

const PORTAL_PATH_FOR_TYPE: Record<z.infer<typeof bodySchema>['type'], string> = {
  FEE: 'portal/fees',
  LEAVE: 'portal/leave',
  ATTENDANCE: 'portal',
  ANNOUNCEMENT: 'portal',
};

export async function POST(request: NextRequest) {
  const current = await getCurrentProfile();
  if (!current) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!isStaff(current.profile.role) || !current.profile.is_active) {
    return NextResponse.json({ error: 'Only school staff can send notifications' }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request body' },
      { status: 400 },
    );
  }
  const input = parsed.data;
  const supabase = createClient();

  const { data: student } = await supabase
    .from('students')
    .select('id, school_id, full_name, parent_name, parent_phone, current_balance')
    .eq('id', input.studentId)
    .maybeSingle();
  if (!student) return NextResponse.json({ error: 'Student not found' }, { status: 404 });

  const { data: school } = await supabase
    .from('schools')
    .select('name, slug')
    .eq('id', student.school_id)
    .maybeSingle();
  if (!school) return NextResponse.json({ error: 'Student not found' }, { status: 404 });

  const portalPath = `${school.slug}/${PORTAL_PATH_FOR_TYPE[input.type]}`;
  const recipient = {
    parentPhone: student.parent_phone,
    parentName: student.parent_name ?? 'Parent',
    studentName: student.full_name,
    schoolName: school.name,
  };

  let whatsapp: FamilyNotification['whatsapp'];
  if (input.priority === 'CRITICAL' && input.type === 'FEE') {
    whatsapp = () =>
      sendFeeDueReminder({
        ...recipient,
        outstandingBalance: formatINR(Math.max(Number(student.current_balance), 0), true),
        portalPathSuffix: `${school.slug}/portal/fees`,
      });
  } else if (input.priority === 'CRITICAL' && input.type === 'ATTENDANCE') {
    whatsapp = () => sendAbsenceAlert({ ...recipient, date: formatDate(todayInIST()) });
  }

  const outcome = await notifyFamily({
    schoolId: student.school_id,
    studentId: student.id,
    title: input.title,
    body: input.body,
    type: input.type,
    link: `/${portalPath}`,
    priority: input.priority,
    whatsapp,
  });

  return NextResponse.json({
    inApp: outcome.inApp,
    whatsapp: outcome.whatsapp
      ? { attempted: true, ok: outcome.whatsapp.ok }
      : { attempted: false, ok: false },
  });
}
