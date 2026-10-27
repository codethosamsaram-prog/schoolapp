import type { UserRole } from '@/types/database';

/**
 * Pure role helpers. Kept out of lib/auth.ts, which is server-only, so client
 * components (the login form) can import them without pulling in the server
 * Supabase client.
 */

export function canManageSchool(role: UserRole): boolean {
  return role === 'SUPER_ADMIN' || role === 'SCHOOL_ADMIN';
}

export function isStaff(role: UserRole): boolean {
  return role === 'SUPER_ADMIN' || role === 'SCHOOL_ADMIN' || role === 'TEACHER';
}

/** Default landing route for a role inside a tenant. */
export function homeRouteForRole(slug: string, role: UserRole): string {
  switch (role) {
    case 'SUPER_ADMIN':
    case 'SCHOOL_ADMIN':
      return `/${slug}/admin/dashboard`;
    case 'TEACHER':
      return `/${slug}/teacher/attendance`;
    case 'PARENT':
    case 'STUDENT':
    default:
      return `/${slug}/portal`;
  }
}

/** School-wide student ID; also the login ID for student accounts. */
export const USN_PATTERN = /^[A-Za-z0-9-]{3,20}$/;

/**
 * Student accounts have no real email. Supabase Auth still needs one, so the
 * login email is derived from the school and the USN. It is never shown and
 * never receives mail; the login form builds it from what the student types.
 */
export function studentLoginEmail(schoolSlug: string, usn: string): string {
  return `${usn.trim().toLowerCase()}@${schoolSlug.toLowerCase()}.students.classroomos.app`;
}
