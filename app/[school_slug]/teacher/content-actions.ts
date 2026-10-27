'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult, HomeworkAttachment, UserRole } from '@/types/database';
import { requireTenantSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { isTenantPath } from '@/lib/storage';
import { gradeFor } from '@/lib/grading';
import { youtubeId } from '@/lib/youtube';

/**
 * Publishing tools for teachers and admins. Every write runs on the caller's
 * own session, so the RLS policies in 20260925000000_portal_hub.sql decide
 * what is allowed; the explicit school_id filters are defence in depth.
 */

const STAFF: readonly UserRole[] = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'];
const ADMINS: readonly UserRole[] = ['SUPER_ADMIN', 'SCHOOL_ADMIN'];

function invalid(error: z.ZodError): { ok: false; error: string; fieldErrors: Record<string, string[]> } {
  return {
    ok: false,
    error: error.issues[0]?.message ?? 'Please correct the highlighted fields.',
    fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
  };
}

function revalidatePortal(slug: string, staffPath: string) {
  revalidatePath(`/${slug}/teacher/${staffPath}`);
  revalidatePath(`/${slug}/portal`, 'layout');
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || null);

const gradeField = z.string().trim().min(1, 'Pick a class').max(20);
const sectionField = z
  .string()
  .trim()
  .max(5)
  .optional()
  .transform((value) => value || null);
const subjectField = z.string().trim().min(2, 'Enter the subject').max(60);
const uuid = z.string().uuid();

async function deleteOwned(
  slug: string,
  table: 'announcements' | 'homework' | 'video_references' | 'syllabus_copies' | 'holiday_calendar',
  id: string,
  roles: readonly UserRole[],
  staffPath: string,
): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(id).success) return { ok: false, error: 'Unknown item.' };

  const { school } = await requireTenantSession(slug, roles);
  const supabase = createClient();
  const { data, error } = await supabase
    .from(table)
    .delete()
    .eq('id', id)
    .eq('school_id', school.id)
    .select('id')
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: 'You can only remove items you posted, unless you are an admin.' };
  }

  revalidatePortal(slug, staffPath);
  return { ok: true, data: { id: data.id } };
}

/* ------------------------------------------------------------ announcements */

const announcementSchema = z
  .object({
    title: z.string().trim().min(3, 'Give it a title').max(150),
    content: z.string().trim().min(1, 'Write the announcement').max(5000),
    targetType: z.enum(['ALL', 'CLASS', 'SECTION']),
    targetGrade: sectionField,
    targetSection: sectionField,
  })
  .refine((value) => value.targetType === 'ALL' || Boolean(value.targetGrade), {
    path: ['targetGrade'],
    message: 'Pick the class',
  })
  .refine((value) => value.targetType !== 'SECTION' || Boolean(value.targetSection), {
    path: ['targetSection'],
    message: 'Pick the section',
  });

export async function createAnnouncement(
  slug: string,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const parsed = announcementSchema.safeParse({
    title: formData.get('title'),
    content: formData.get('content'),
    targetType: formData.get('targetType'),
    targetGrade: formData.get('targetGrade') || undefined,
    targetSection: formData.get('targetSection') || undefined,
  });
  if (!parsed.success) return invalid(parsed.error);

  const { userId, school } = await requireTenantSession(slug, STAFF);
  const { targetType } = parsed.data;

  const { data, error } = await createClient()
    .from('announcements')
    .insert({
      school_id: school.id,
      title: parsed.data.title,
      content: parsed.data.content,
      target_type: targetType,
      target_grade: targetType === 'ALL' ? null : parsed.data.targetGrade,
      target_section: targetType === 'SECTION' ? parsed.data.targetSection : null,
      created_by: userId,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('[content] announcement insert failed', { error: error?.message });
    return { ok: false, error: 'Could not post the announcement. Please try again.' };
  }

  revalidatePortal(slug, 'announcements');
  return { ok: true, data: { id: data.id } };
}

export async function deleteAnnouncement(slug: string, id: string) {
  return deleteOwned(slug, 'announcements', id, STAFF, 'announcements');
}

/* ------------------------------------------------------------------ homework */

const attachmentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  path: z.string().min(1).max(300),
});

const homeworkSchema = z.object({
  classGrade: gradeField,
  section: sectionField,
  subject: subjectField,
  title: z.string().trim().min(3, 'Give it a title').max(150),
  description: optionalText(3000),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the due date'),
  attachments: z.array(attachmentSchema).max(5, 'Attach at most 5 files'),
});

export async function createHomework(
  slug: string,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  let attachments: unknown = [];
  try {
    attachments = JSON.parse(String(formData.get('attachments') || '[]'));
  } catch {
    return { ok: false, error: 'The attachments could not be read.' };
  }

  const parsed = homeworkSchema.safeParse({
    classGrade: formData.get('classGrade'),
    section: formData.get('section') || undefined,
    subject: formData.get('subject'),
    title: formData.get('title'),
    description: formData.get('description') || undefined,
    dueDate: formData.get('dueDate'),
    attachments,
  });
  if (!parsed.success) return invalid(parsed.error);

  const { userId, school } = await requireTenantSession(slug, STAFF);

  const files: HomeworkAttachment[] = parsed.data.attachments;
  if (files.some((file) => !isTenantPath(file.path, school.id))) {
    return { ok: false, error: 'An attachment was not uploaded for this school.' };
  }

  const { data, error } = await createClient()
    .from('homework')
    .insert({
      school_id: school.id,
      class_grade: parsed.data.classGrade,
      section: parsed.data.section,
      subject: parsed.data.subject,
      title: parsed.data.title,
      description: parsed.data.description,
      due_date: parsed.data.dueDate,
      attachments: files,
      created_by: userId,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('[content] homework insert failed', { error: error?.message });
    return { ok: false, error: 'Could not post the homework. Please try again.' };
  }

  revalidatePortal(slug, 'homework');
  return { ok: true, data: { id: data.id } };
}

export async function deleteHomework(slug: string, id: string) {
  return deleteOwned(slug, 'homework', id, STAFF, 'homework');
}

/* -------------------------------------------------------- video references */

const videoSchema = z.object({
  classGrade: gradeField,
  section: sectionField,
  subject: subjectField,
  youtubeUrl: z
    .string()
    .trim()
    .transform((value, ctx) => {
      const id = youtubeId(value);
      if (!id) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Paste a YouTube video link' });
        return z.NEVER;
      }
      // Stored in one canonical shape, which the table's check constraint expects.
      return `https://www.youtube.com/watch?v=${id}`;
    }),
  title: z.string().trim().min(3, 'Give it a title').max(150),
  description: optionalText(1000),
});

export async function createVideoReference(
  slug: string,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const parsed = videoSchema.safeParse({
    classGrade: formData.get('classGrade'),
    section: formData.get('section') || undefined,
    subject: formData.get('subject'),
    youtubeUrl: formData.get('youtubeUrl'),
    title: formData.get('title'),
    description: formData.get('description') || undefined,
  });
  if (!parsed.success) return invalid(parsed.error);

  const { userId, school } = await requireTenantSession(slug, STAFF);

  const { data, error } = await createClient()
    .from('video_references')
    .insert({
      school_id: school.id,
      class_grade: parsed.data.classGrade,
      section: parsed.data.section,
      subject: parsed.data.subject,
      youtube_url: parsed.data.youtubeUrl,
      title: parsed.data.title,
      description: parsed.data.description,
      created_by: userId,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('[content] video insert failed', { error: error?.message });
    return { ok: false, error: 'Could not add the video. Please try again.' };
  }

  revalidatePortal(slug, 'homework');
  return { ok: true, data: { id: data.id } };
}

export async function deleteVideoReference(slug: string, id: string) {
  return deleteOwned(slug, 'video_references', id, STAFF, 'homework');
}

/* ---------------------------------------------------------------- results */

const resultsSchema = z.object({
  examName: z.string().trim().min(2, 'Name the exam').max(80),
  subject: subjectField,
  maxMarks: z.coerce.number().positive('Enter the maximum marks').max(1000),
  entries: z
    .array(
      z.object({
        studentId: uuid,
        marks: z.number().min(0).nullable(),
        remarks: z.string().trim().max(200).nullable(),
      }),
    )
    .max(200),
});

export type ResultEntryInput = { studentId: string; marks: number | null; remarks: string | null };

/**
 * Saves one subject's marks for a class. Blank marks are skipped, not zeroed.
 * The grade is derived from the percentage (CBSE nine-point scale).
 */
export async function saveExamResults(
  slug: string,
  input: { examName: string; subject: string; maxMarks: number; entries: ResultEntryInput[] },
): Promise<ActionResult<{ saved: number }>> {
  const parsed = resultsSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const { maxMarks, examName, subject } = parsed.data;
  const over = parsed.data.entries.find((entry) => entry.marks !== null && entry.marks > maxMarks);
  if (over) {
    return { ok: false, error: `Marks cannot exceed the maximum of ${maxMarks}.` };
  }

  const { userId, school } = await requireTenantSession(slug, STAFF);
  const supabase = createClient();
  const rows = parsed.data.entries.filter(
    (entry): entry is { studentId: string; marks: number; remarks: string | null } => entry.marks !== null,
  );

  if (rows.length === 0) return { ok: false, error: 'Enter marks for at least one student.' };

  const { data: roster } = await supabase
    .from('students')
    .select('id')
    .eq('school_id', school.id)
    .in('id', rows.map((row) => row.studentId));

  if ((roster ?? []).length !== rows.length) {
    return { ok: false, error: 'Some of these students are not on your roll.' };
  }

  const { data, error } = await supabase
    .from('exam_results')
    .upsert(
      rows.map((row) => ({
        school_id: school.id,
        student_id: row.studentId,
        exam_name: examName,
        subject,
        marks_obtained: row.marks,
        max_marks: maxMarks,
        grade: gradeFor(row.marks, maxMarks).grade,
        remarks: row.remarks,
        entered_by: userId,
      })),
      { onConflict: 'student_id,exam_name,subject' },
    )
    .select('id');

  if (error) {
    console.error('[content] results upsert failed', { error: error.message });
    return { ok: false, error: 'Could not save the marks. Please try again.' };
  }

  revalidatePortal(slug, 'exams');
  return { ok: true, data: { saved: data?.length ?? 0 } };
}

/* ------------------------------------------------------------ hall tickets */

const hallTicketSchema = z.object({
  classGrade: gradeField,
  section: sectionField,
  examName: z.string().trim().min(2, 'Name the exam').max(80),
  term: z.string().trim().min(1, 'Enter the term').max(40),
  publish: z.boolean(),
});

/** Issues a hall ticket to every active student in a class (or section). */
export async function issueHallTickets(
  slug: string,
  input: { classGrade: string; section?: string; examName: string; term: string; publish: boolean },
): Promise<ActionResult<{ issued: number }>> {
  const parsed = hallTicketSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const { userId, school } = await requireTenantSession(slug, STAFF);
  const supabase = createClient();

  let query = supabase
    .from('students')
    .select('id')
    .eq('school_id', school.id)
    .eq('class_grade', parsed.data.classGrade)
    .eq('is_active', true);
  if (parsed.data.section) query = query.eq('section', parsed.data.section);

  const { data: students, error: studentError } = await query;
  if (studentError || !students || students.length === 0) {
    return { ok: false, error: 'No active students in that class.' };
  }

  const { data, error } = await supabase
    .from('hall_tickets')
    .upsert(
      students.map((student) => ({
        school_id: school.id,
        student_id: student.id,
        exam_name: parsed.data.examName,
        term: parsed.data.term,
        is_published: parsed.data.publish,
        issued_by: userId,
      })),
      { onConflict: 'student_id,exam_name,term' },
    )
    .select('id');

  if (error) {
    console.error('[content] hall ticket upsert failed', { error: error.message });
    return { ok: false, error: 'Could not issue the hall tickets. Please try again.' };
  }

  revalidatePortal(slug, 'exams');
  return { ok: true, data: { issued: data?.length ?? 0 } };
}

/** Publishes or withdraws every ticket of one exam and term. */
export async function setHallTicketsPublished(
  slug: string,
  input: { examName: string; term: string; published: boolean },
): Promise<ActionResult<{ updated: number }>> {
  const parsed = z
    .object({ examName: z.string().min(1).max(80), term: z.string().min(1).max(40), published: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const { school } = await requireTenantSession(slug, STAFF);
  const { data, error } = await createClient()
    .from('hall_tickets')
    .update({ is_published: parsed.data.published })
    .eq('school_id', school.id)
    .eq('exam_name', parsed.data.examName)
    .eq('term', parsed.data.term)
    .select('id');

  if (error) {
    return { ok: false, error: 'Could not update the hall tickets. Please try again.' };
  }

  revalidatePortal(slug, 'exams');
  return { ok: true, data: { updated: data?.length ?? 0 } };
}

/* ---------------------------------------------------------------- syllabus */

const syllabusSchema = z.object({
  classGrade: gradeField,
  subject: subjectField,
  path: z.string().min(1).max(300),
});

/** Publishes (or replaces) the syllabus PDF for one class and subject. */
export async function saveSyllabus(
  slug: string,
  input: { classGrade: string; subject: string; path: string },
): Promise<ActionResult<{ id: string }>> {
  const parsed = syllabusSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const { userId, school } = await requireTenantSession(slug, STAFF);
  if (!isTenantPath(parsed.data.path, school.id)) {
    return { ok: false, error: 'That file was not uploaded for this school.' };
  }

  const supabase = createClient();
  const { data: academicYear } = await supabase.rpc('current_academic_year');

  const { data: previous } = await supabase
    .from('syllabus_copies')
    .select('pdf_url')
    .eq('school_id', school.id)
    .eq('academic_year', academicYear ?? '')
    .eq('class_grade', parsed.data.classGrade)
    .eq('subject', parsed.data.subject)
    .maybeSingle();

  const { data, error } = await supabase
    .from('syllabus_copies')
    .upsert(
      {
        school_id: school.id,
        class_grade: parsed.data.classGrade,
        subject: parsed.data.subject,
        pdf_url: parsed.data.path,
        academic_year: academicYear ?? undefined,
        uploaded_by: userId,
      },
      { onConflict: 'school_id,academic_year,class_grade,subject' },
    )
    .select('id')
    .single();

  if (error || !data) {
    console.error('[content] syllabus upsert failed', { error: error?.message });
    return { ok: false, error: 'Could not publish the syllabus. Please try again.' };
  }

  if (previous?.pdf_url && previous.pdf_url !== parsed.data.path) {
    await supabase.storage.from('academic-docs').remove([previous.pdf_url]);
  }

  revalidatePortal(slug, 'exams');
  return { ok: true, data: { id: data.id } };
}

export async function deleteSyllabus(slug: string, id: string) {
  return deleteOwned(slug, 'syllabus_copies', id, STAFF, 'exams');
}

/* ---------------------------------------------------------------- holidays */

const holidaySchema = z.object({
  title: z.string().trim().min(2, 'Name the day').max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the date'),
  description: optionalText(300),
  isAcademicHoliday: z.boolean(),
});

export async function createHoliday(
  slug: string,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const parsed = holidaySchema.safeParse({
    title: formData.get('title'),
    date: formData.get('date'),
    description: formData.get('description') || undefined,
    isAcademicHoliday: formData.get('isAcademicHoliday') === 'on',
  });
  if (!parsed.success) return invalid(parsed.error);

  const { school } = await requireTenantSession(slug, ADMINS);
  const { data, error } = await createClient()
    .from('holiday_calendar')
    .insert({
      school_id: school.id,
      title: parsed.data.title,
      date: parsed.data.date,
      description: parsed.data.description,
      is_academic_holiday: parsed.data.isAcademicHoliday,
    })
    .select('id')
    .single();

  if (error || !data) {
    if (error?.code === '23505') return { ok: false, error: 'That day is already on the calendar.' };
    console.error('[content] holiday insert failed', { error: error?.message });
    return { ok: false, error: 'Could not add the day. Please try again.' };
  }

  revalidatePath(`/${slug}/admin/calendar`);
  revalidatePath(`/${slug}/portal`, 'layout');
  return { ok: true, data: { id: data.id } };
}

export async function deleteHoliday(slug: string, id: string) {
  const result = await deleteOwned(slug, 'holiday_calendar', id, ADMINS, 'announcements');
  revalidatePath(`/${slug}/admin/calendar`);
  return result;
}
