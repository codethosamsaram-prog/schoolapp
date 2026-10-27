import 'server-only';

import { cache } from 'react';
import { cookies } from 'next/headers';
import type { Profile, School } from '@/types/database';
import { requireTenantSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { signedUrls } from '@/lib/storage';

export interface PortalStudent {
  id: string;
  fullName: string;
  usn: string | null;
  rollNumber: string;
  admissionNumber: string | null;
  classGrade: string;
  section: string;
  parentName: string | null;
  parentPhone: string;
  dateOfBirth: string | null;
  gender: string | null;
  totalFeeDue: number;
  currentBalance: number;
  feeConcession: number;
  photoUrl: string | null;
  isSelf: boolean;
}

export interface PortalContext {
  userId: string;
  profile: Profile;
  school: School;
  students: PortalStudent[];
  active: PortalStudent | null;
}

export function activeStudentCookie(schoolId: string): string {
  return `cos_child_${schoolId.slice(0, 8)}`;
}

/**
 * Everything the portal pages share: the session, the students linked to
 * this account (a student's own record, or a parent's children), and which
 * one is selected. Cached per request, so the layout and the page issue these
 * queries once.
 */
export const getPortalContext = cache(async (slug: string): Promise<PortalContext> => {
  const { userId, profile, school } = await requireTenantSession(slug, ['PARENT', 'STUDENT']);
  const supabase = createClient();

  // RLS already limits this to the caller's own record or linked children;
  // the explicit filter keeps the portal correct if a policy is ever widened.
  const { data, error } = await supabase
    .from('students')
    .select(
      'id, user_id, full_name, usn, roll_number, admission_number, class_grade, section, parent_name, parent_phone, date_of_birth, gender, total_fee_due, current_balance, fee_concession, avatar_url',
    )
    .eq('school_id', school.id)
    .eq('is_active', true)
    .or(`user_id.eq.${userId},parent_user_id.eq.${userId}`)
    .order('full_name');

  if (error) console.error('[portal] students query failed', { error: error.message });

  const rows = data ?? [];
  const photos = await signedUrls(supabase, 'avatars', rows.map((row) => row.avatar_url));

  const students: PortalStudent[] = rows.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    usn: row.usn,
    rollNumber: row.roll_number,
    admissionNumber: row.admission_number,
    classGrade: row.class_grade,
    section: row.section,
    parentName: row.parent_name,
    parentPhone: row.parent_phone,
    dateOfBirth: row.date_of_birth,
    gender: row.gender,
    totalFeeDue: Number(row.total_fee_due),
    currentBalance: Number(row.current_balance),
    feeConcession: Number(row.fee_concession),
    photoUrl: row.avatar_url ? photos.get(row.avatar_url) ?? null : null,
    isSelf: row.user_id === userId,
  }));

  const chosen = cookies().get(activeStudentCookie(school.id))?.value;
  const active = students.find((student) => student.id === chosen) ?? students[0] ?? null;

  return { userId, profile, school, students, active };
});
