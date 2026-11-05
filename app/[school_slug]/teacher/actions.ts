'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult, AttendanceStatus } from '@/types/database';
import { createClient } from '@/lib/supabase/server';
import { requireTenantSession } from '@/lib/auth';
import { sendAbsenceAlert } from '@/lib/whatsapp';
import { notifyFamilies, wasDelivered } from '@/lib/notifications';
import { formatDate, todayInIST } from '@/lib/utils';

const entrySchema = z.object({
  studentId: z.string().uuid(),
  status: z.enum(['PRESENT', 'ABSENT', 'LATE']),
});

const submissionSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a valid date')
    .refine((value) => value <= todayInIST(), 'Attendance cannot be marked for a future date'),
  entries: z.array(entrySchema).min(1, 'Mark at least one student').max(200),
  notifyAbsentees: z.boolean().default(true),
});

export interface AttendanceEntryInput {
  studentId: string;
  status: AttendanceStatus;
}

export interface BulkAttendanceResult {
  saved: number;
  absent: number;
  notificationsSent: number;
}

/**
 * Bulk attendance submission for one class and section.
 *
 * Writes through the teacher's own client so `attendance_insert_staff` and
 * `attendance_update_staff` apply, including their marked_by = auth.uid()
 * requirement. The upsert targets the (student_id, date) unique constraint,
 * which makes re-submitting a corrected sheet safe.
 */
export async function submitBulkAttendance(
  schoolSlug: string,
  input: { date: string; entries: AttendanceEntryInput[]; notifyAbsentees?: boolean },
): Promise<ActionResult<BulkAttendanceResult>> {
  const parsed = submissionSchema.safeParse({
    date: input.date,
    entries: input.entries,
    notifyAbsentees: input.notifyAbsentees ?? true,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'That attendance sheet is not valid.',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { userId, school } = await requireTenantSession(schoolSlug, [
    'SUPER_ADMIN',
    'SCHOOL_ADMIN',
    'TEACHER',
  ]);

  const supabase = createClient();
  const studentIds = parsed.data.entries.map((entry) => entry.studentId);

  // Confirm every id in the sheet belongs to this tenant before writing.
  const { data: roster, error: rosterError } = await supabase
    .from('students')
    .select('id, full_name, parent_name, parent_phone')
    .eq('school_id', school.id)
    .eq('is_active', true)
    .in('id', studentIds);

  if (rosterError) {
    console.error('[attendance] roster verification failed', { error: rosterError.message });
    return { ok: false, error: 'Could not verify the class roster. Please try again.' };
  }

  const known = new Map((roster ?? []).map((student) => [student.id, student]));
  if (known.size !== studentIds.length) {
    return { ok: false, error: 'This sheet contains students who are not on your roster.' };
  }

  // Approved leave stands: a sheet taken before the leave was approved, or
  // one that defaults everyone to present, must not overwrite it.
  const { data: excused } = await supabase
    .from('attendance')
    .select('student_id')
    .eq('date', parsed.data.date)
    .eq('status', 'EXCUSED_ABSENT')
    .in('student_id', studentIds);
  const onLeave = new Set((excused ?? []).map((row) => row.student_id));
  const entries = parsed.data.entries.filter((entry) => !onLeave.has(entry.studentId));

  const { data: saved, error: upsertError } =
    entries.length === 0
      ? { data: [], error: null }
      : await supabase
          .from('attendance')
          .upsert(
            entries.map((entry) => ({
              school_id: school.id,
              student_id: entry.studentId,
              date: parsed.data.date,
              status: entry.status,
              marked_by: userId,
            })),
            { onConflict: 'student_id,date' },
          )
          .select('id, student_id, status');

  if (upsertError) {
    console.error('[attendance] upsert failed', { error: upsertError.message });
    return { ok: false, error: 'Could not save attendance. Please try again.' };
  }

  const absentees = (saved ?? []).filter((row) => row.status === 'ABSENT');
  let notificationsSent = 0;

  if (parsed.data.notifyAbsentees && absentees.length > 0) {
    const dateLabel = formatDate(parsed.data.date);

    // In-app to every family with a portal login; WhatsApp only for those
    // without one (see lib/notifications.ts).
    const outcomes = await notifyFamilies(
      absentees.flatMap((row) => {
        const student = known.get(row.student_id);
        if (!student) return [];
        return [
          {
            schoolId: school.id,
            studentId: student.id,
            type: 'ATTENDANCE' as const,
            title: 'Marked absent',
            body: `${student.full_name} was marked absent on ${dateLabel}.`,
            link: `/${school.slug}/portal`,
            whatsapp: () =>
              sendAbsenceAlert({
                parentPhone: student.parent_phone,
                parentName: student.parent_name ?? 'Parent',
                studentName: student.full_name,
                schoolName: school.name,
                date: dateLabel,
              }),
          },
        ];
      }),
    );
    notificationsSent = outcomes.filter(wasDelivered).length;
  }

  revalidatePath(`/${schoolSlug}/teacher/attendance`);
  revalidatePath(`/${schoolSlug}/admin/dashboard`);

  return {
    ok: true,
    data: {
      saved: saved?.length ?? 0,
      absent: absentees.length,
      notificationsSent,
    },
  };
}
