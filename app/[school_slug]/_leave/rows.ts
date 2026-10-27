import 'server-only';

import type { LeaveApplicant, LeaveStatus, LeaveType, UserRole } from '@/types/database';
import type { createClient } from '@/lib/supabase/server';
import type { LeaveRowView } from './leave-components';

type SessionClient = ReturnType<typeof createClient>;

export const LEAVE_SELECT =
  'id, applicant_kind, student_id, staff_user_id, requested_by, leave_type, start_date, end_date, reason, status, review_note, reviewed_at, created_at, students(full_name, class_grade, section)';

interface LeaveQueryRow {
  id: string;
  applicant_kind: LeaveApplicant;
  student_id: string | null;
  staff_user_id: string | null;
  requested_by: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string;
  status: LeaveStatus;
  review_note: string | null;
  reviewed_at: string | null;
  students: { full_name: string; class_grade: string; section: string } | null;
}

const ROLE_NAMES: Partial<Record<UserRole, string>> = {
  TEACHER: 'Teacher',
  SCHOOL_ADMIN: 'Administration',
};

/**
 * Shapes leave rows for LeaveList, deciding per row what the viewer may do.
 * The database enforces the same rules; this only hides buttons that would fail.
 */
export async function toLeaveRows(
  supabase: SessionClient,
  data: unknown[] | null,
  viewer: { userId: string; role: UserRole },
): Promise<LeaveRowView[]> {
  const rows = (data ?? []) as LeaveQueryRow[];
  const staffIds = [...new Set(rows.map((row) => row.staff_user_id).filter((id): id is string => Boolean(id)))];

  const staffNames = new Map<string, { name: string; role: UserRole }>();
  if (staffIds.length) {
    const { data: profiles } = await supabase.from('profiles').select('id, full_name, email, role').in('id', staffIds);
    for (const profile of profiles ?? []) {
      staffNames.set(profile.id, { name: profile.full_name || profile.email || 'Staff member', role: profile.role });
    }
  }

  const isStaff = viewer.role === 'TEACHER' || viewer.role === 'SCHOOL_ADMIN' || viewer.role === 'SUPER_ADMIN';
  const isAdmin = viewer.role === 'SCHOOL_ADMIN' || viewer.role === 'SUPER_ADMIN';

  return rows.map((row) => {
    const staff = row.staff_user_id ? staffNames.get(row.staff_user_id) : undefined;
    const own = row.requested_by === viewer.userId || row.staff_user_id === viewer.userId;
    return {
      id: row.id,
      kind: row.applicant_kind,
      applicant:
        row.applicant_kind === 'STUDENT' ? row.students?.full_name ?? 'Student' : staff?.name ?? 'Staff member',
      detail:
        row.applicant_kind === 'STUDENT'
          ? row.students
            ? `Class ${row.students.class_grade}-${row.students.section}`
            : 'Student'
          : (staff && ROLE_NAMES[staff.role]) ?? 'Staff',
      leaveType: row.leave_type,
      startDate: row.start_date,
      endDate: row.end_date,
      reason: row.reason,
      status: row.status,
      reviewNote: row.review_note,
      reviewedAt: row.reviewed_at,
      canCancel: row.status === 'PENDING' && row.requested_by === viewer.userId,
      canReview: isStaff && !own && (row.applicant_kind === 'STUDENT' || isAdmin),
    };
  });
}
