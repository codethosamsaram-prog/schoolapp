'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult } from '@/types/database';
import { activeStudentCookie, getPortalContext } from '@/lib/portal';

/**
 * Switches which child the portal shows. The id must be one of the caller's
 * own linked students; the cookie only chooses among rows RLS already allows.
 */
export async function setActiveStudent(
  schoolSlug: string,
  studentId: string,
): Promise<ActionResult<{ studentId: string }>> {
  if (!z.string().uuid().safeParse(studentId).success) {
    return { ok: false, error: 'Unknown student.' };
  }

  const { school, students } = await getPortalContext(schoolSlug);
  if (!students.some((student) => student.id === studentId)) {
    return { ok: false, error: 'That student is not linked to your account.' };
  }

  cookies().set(activeStudentCookie(school.id), studentId, {
    path: `/${schoolSlug}`,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 180,
  });

  revalidatePath(`/${schoolSlug}/portal`, 'layout');
  return { ok: true, data: { studentId } };
}
