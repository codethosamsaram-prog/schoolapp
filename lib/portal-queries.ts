import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type { PortalStudent } from '@/lib/portal';

type Client = SupabaseClient<Database>;

/**
 * PostgREST or() filter for rows addressed to the student's class: the whole
 * grade (section null) or their own section. Grades and sections are short
 * alphanumeric codes, so they need no quoting inside the filter string.
 */
function classFilter(student: PortalStudent): string {
  return `section.is.null,section.eq.${student.section}`;
}

export function announcementsFor(supabase: Client, schoolId: string, student: PortalStudent, limit = 20) {
  return supabase
    .from('announcements')
    .select('*')
    .eq('school_id', schoolId)
    .or(
      [
        'target_type.eq.ALL',
        `and(target_type.eq.CLASS,target_grade.eq.${student.classGrade})`,
        `and(target_type.eq.SECTION,target_grade.eq.${student.classGrade},target_section.eq.${student.section})`,
      ].join(','),
    )
    .order('created_at', { ascending: false })
    .limit(limit);
}

export function videosFor(supabase: Client, schoolId: string, student: PortalStudent, limit = 6) {
  return supabase
    .from('video_references')
    .select('*')
    .eq('school_id', schoolId)
    .eq('class_grade', student.classGrade)
    .or(classFilter(student))
    .order('created_at', { ascending: false })
    .limit(limit);
}

export function homeworkFor(supabase: Client, schoolId: string, student: PortalStudent) {
  return supabase
    .from('homework')
    .select('*')
    .eq('school_id', schoolId)
    .eq('class_grade', student.classGrade)
    .or(classFilter(student));
}
