'use server';

import { z } from 'zod';
import type { ActionResult } from '@/types/database';
import { getCurrentProfile } from '@/lib/auth';
import { homeRouteForRole } from '@/lib/auth-routes';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { toLocalIndianNumber } from '@/lib/utils';

const credentialSchema = z
  .object({
    password: z
      .string()
      .min(10, 'Use at least 10 characters')
      .max(72, 'Use at most 72 characters')
      .regex(/[A-Za-z]/, 'Include at least one letter')
      .regex(/\d/, 'Include at least one number'),
    confirm: z.string(),
    phone: z
      .string()
      .trim()
      .optional()
      .transform((value, ctx) => {
        if (!value) return undefined;
        const local = toLocalIndianNumber(value);
        if (!local) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a 10-digit Indian mobile number' });
          return z.NEVER;
        }
        return local;
      }),
    next: z.string().optional(),
  })
  .refine((value) => value.password === value.confirm, {
    path: ['confirm'],
    message: 'The passwords do not match',
  });

/**
 * Completes the first sign-in with a school-issued temporary password.
 *
 * The password change goes through supabase.auth.updateUser() on the user's
 * own session. The flag is then cleared with the service role, because
 * guard_profile_privileges stops users clearing it themselves (which would let
 * them skip this step through the API).
 */
export async function completeFirstLogin(
  formData: FormData,
): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = credentialSchema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
    phone: formData.get('phone') || undefined,
    next: formData.get('next') || undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Please correct the highlighted fields.',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const current = await getCurrentProfile();
  if (!current) {
    return { ok: false, error: 'Your session has expired. Please sign in again.' };
  }

  const supabase = createClient();
  const { profile, userId } = current;

  if (profile.must_change_password) {
    const { error: updateError } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (updateError) {
      const same = /different from the old password/i.test(updateError.message);
      return {
        ok: false,
        error: same ? 'Choose a password different from the temporary one.' : updateError.message,
        fieldErrors: { password: [same ? 'Must differ from the temporary password' : updateError.message] },
      };
    }

    const admin = createAdminClient();
    const { error: flagError } = await admin
      .from('profiles')
      .update({
        must_change_password: false,
        ...(parsed.data.phone ? { phone: parsed.data.phone } : {}),
      })
      .eq('id', userId);

    if (flagError) {
      console.error('[login] could not clear first-login flag', { error: flagError.message });
      return { ok: false, error: 'Password updated, but we could not finish setup. Please try again.' };
    }

    // Keep app_metadata in step so a later metadata write cannot resurrect it.
    const { data: authUser } = await admin.auth.admin.getUserById(userId);
    if (authUser.user) {
      await admin.auth.admin.updateUserById(userId, {
        app_metadata: { ...authUser.user.app_metadata, must_change_password: false },
      });
    }
  }

  let slug: string | null = null;
  if (profile.school_id) {
    const { data: school } = await supabase
      .from('schools')
      .select('slug')
      .eq('id', profile.school_id)
      .maybeSingle();
    slug = school?.slug ?? null;
  }

  const next = parsed.data.next;
  const redirectTo =
    next && next.startsWith('/') && !next.startsWith('//')
      ? next
      : slug
        ? homeRouteForRole(slug, profile.role)
        : '/';

  return { ok: true, data: { redirectTo } };
}
