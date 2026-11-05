'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult } from '@/types/database';
import { activeStudentCookie, getPortalContext } from '@/lib/portal';
import { createClient } from '@/lib/supabase/server';

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

/**
 * Marks the caller's notifications read: the given ids, or all of them.
 * Runs on the caller's session, where RLS and the column grant allow
 * nothing but flipping is_read on their own rows.
 */
export async function markNotificationsRead(
  schoolSlug: string,
  ids?: string[],
): Promise<ActionResult<{ updated: number }>> {
  if (ids && !z.array(z.string().uuid()).max(200).safeParse(ids).success) {
    return { ok: false, error: 'Unknown notification.' };
  }

  const { userId } = await getPortalContext(schoolSlug);
  const supabase = createClient();

  let request = supabase.from('notifications').update({ is_read: true }).eq('user_id', userId).eq('is_read', false);
  if (ids) request = request.in('id', ids);
  const { data, error } = await request.select('id');

  if (error) {
    console.error('[portal] mark read failed', { error: error.message });
    return { ok: false, error: 'Could not update your notifications. Please try again.' };
  }

  revalidatePath(`/${schoolSlug}/portal`, 'layout');
  return { ok: true, data: { updated: data?.length ?? 0 } };
}
