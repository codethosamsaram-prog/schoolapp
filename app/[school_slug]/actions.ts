'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionResult } from '@/types/database';
import { createAdminClient } from '@/lib/supabase/admin';
import { createAnonClient } from '@/lib/supabase/server';
import { rateLimit } from '@/lib/rate-limit';
import { sendAdmissionAcknowledgement } from '@/lib/whatsapp';
import { CLASS_GRADES } from '@/lib/constants';

const admissionSchema = z.object({
  applicantName: z
    .string()
    .trim()
    .min(2, 'Enter the student name')
    .max(120, 'Name is too long'),
  parentName: z
    .string()
    .trim()
    .min(2, 'Enter the parent or guardian name')
    .max(120, 'Name is too long'),
  phone: z
    .string()
    .trim()
    .transform((value) => value.replace(/\D/g, '').slice(-10))
    .refine((value) => /^[6-9]\d{9}$/.test(value), 'Enter a valid 10-digit Indian mobile number'),
  email: z
    .string()
    .trim()
    .email('Enter a valid email address')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  targetGrade: z.enum(CLASS_GRADES, { errorMap: () => ({ message: 'Select the grade applied for' }) }),
  message: z.string().trim().max(600, 'Please keep the note under 600 characters').optional(),
});

export interface AdmissionSubmissionResult {
  leadId: string;
  whatsappDelivered: boolean;
}

/**
 * Public admission enquiry.
 *
 * The insert runs on the anonymous client so the `leads_insert_public` policy
 * is the thing that authorises it: the row must name an active tenant, carry
 * source PUBLIC_PORTAL and status NEW. The service-role client is used only
 * afterwards, to stamp notified_at, which anon has no UPDATE grant for.
 */
export async function submitAdmissionEnquiry(
  schoolSlug: string,
  formData: FormData,
): Promise<ActionResult<AdmissionSubmissionResult>> {
  const parsed = admissionSchema.safeParse({
    applicantName: formData.get('applicantName'),
    parentName: formData.get('parentName'),
    phone: formData.get('phone'),
    email: formData.get('email'),
    targetGrade: formData.get('targetGrade'),
    message: formData.get('message'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  // Honeypot: a real browser never fills a field it cannot see.
  if (typeof formData.get('company') === 'string' && String(formData.get('company')).length > 0) {
    return { ok: true, data: { leadId: 'discarded', whatsappDelivered: false } };
  }

  const forwardedFor = headers().get('x-forwarded-for') ?? 'unknown';
  const clientIp = forwardedFor.split(',')[0]?.trim() || 'unknown';
  const limit = rateLimit(`admission:${schoolSlug}:${clientIp}`, 5, 60_000);
  if (!limit.allowed) {
    return {
      ok: false,
      error: `Too many submissions. Please try again in ${limit.retryAfterSeconds} seconds.`,
    };
  }

  const anon = createAnonClient();

  const { data: school, error: schoolError } = await anon
    .from('schools')
    .select('id, name, slug, contact_phone')
    .eq('slug', schoolSlug)
    .eq('is_active', true)
    .maybeSingle();

  if (schoolError || !school) {
    return { ok: false, error: 'This school portal is not accepting enquiries right now.' };
  }

  const input = parsed.data;

  const { data: lead, error: insertError } = await anon
    .from('admission_leads')
    .insert({
      school_id: school.id,
      applicant_name: input.applicantName,
      parent_name: input.parentName,
      phone: input.phone,
      email: input.email ?? null,
      target_grade: input.targetGrade,
      message: input.message ?? null,
      source: 'PUBLIC_PORTAL',
      status: 'NEW',
    })
    .select('id')
    .single();

  if (insertError || !lead) {
    console.error('[admissions] insert failed', { slug: schoolSlug, error: insertError?.message });
    return { ok: false, error: 'We could not record your enquiry. Please try again.' };
  }

  const whatsapp = await sendAdmissionAcknowledgement({
    parentPhone: input.phone,
    parentName: input.parentName,
    applicantName: input.applicantName,
    schoolName: school.name,
    targetGrade: input.targetGrade,
    schoolPhone: school.contact_phone,
  });

  if (whatsapp.ok) {
    const admin = createAdminClient();
    const { error: stampError } = await admin
      .from('admission_leads')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', lead.id)
      .eq('school_id', school.id);

    if (stampError) {
      console.error('[admissions] failed to stamp notified_at', { leadId: lead.id, error: stampError.message });
    }
  }

  revalidatePath(`/${schoolSlug}/admin/dashboard`);

  return { ok: true, data: { leadId: lead.id, whatsappDelivered: whatsapp.ok } };
}
