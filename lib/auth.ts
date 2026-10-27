import 'server-only';

import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import type { Profile, School, UserRole } from '@/types/database';
import { createAnonClient, createClient } from '@/lib/supabase/server';

export interface TenantSession {
  userId: string;
  profile: Profile;
  school: School;
}

/**
 * Resolves a tenant from its public slug. Cached per request so a page that
 * renders the header, the hero and the fee table issues one query, not three.
 */
export const getSchoolBySlug = cache(async (slug: string): Promise<School | null> => {
  const supabase = createAnonClient();
  const { data, error } = await supabase
    .from('schools')
    .select('*')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    console.error('[auth] failed to resolve school by slug', { slug, error: error.message });
    return null;
  }
  return data;
});

export const getCurrentProfile = cache(async (): Promise<{ userId: string; profile: Profile } | null> => {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (error || !profile) return null;
  return { userId: user.id, profile };
});

/**
 * Guard for every authenticated tenant route: /[school_slug]/admin/**, etc.
 *
 * Verifies in order that the slug resolves, that a session exists, that the
 * profile belongs to that tenant, and that the role is allowed. The database
 * would reject a cross-tenant read anyway; this exists so the user gets a
 * redirect instead of an empty page.
 */
export async function requireTenantSession(
  slug: string,
  allowedRoles: readonly UserRole[],
): Promise<TenantSession> {
  const school = await getSchoolBySlug(slug);
  if (!school) notFound();

  const current = await getCurrentProfile();
  if (!current) {
    redirect(`/login?next=${encodeURIComponent(`/${slug}`)}`);
  }

  const { userId, profile } = current;

  const belongsToTenant = profile.role === 'SUPER_ADMIN' || profile.school_id === school.id;
  if (!belongsToTenant || !profile.is_active) {
    redirect(`/${slug}?error=forbidden`);
  }

  // A school-issued temporary password must be replaced before anything else.
  if (profile.must_change_password) {
    redirect(`/login?school=${encodeURIComponent(slug)}&next=${encodeURIComponent(`/${slug}`)}`);
  }

  if (!allowedRoles.includes(profile.role)) {
    redirect(`/${slug}?error=insufficient-role`);
  }

  return { userId, profile, school };
}

export { canManageSchool, isStaff, homeRouteForRole } from '@/lib/auth-routes';
