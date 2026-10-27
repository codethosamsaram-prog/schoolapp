import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { CLASS_GRADES } from '@/lib/constants';

export interface SchoolClasses {
  /** Grades with at least one active student, Nursery to XII. */
  grades: string[];
  sectionsByGrade: Record<string, string[]>;
}

export function gradeRank(grade: string): number {
  const index = (CLASS_GRADES as readonly string[]).indexOf(grade);
  return index === -1 ? CLASS_GRADES.length : index;
}

/** The classes a school actually runs, derived from its active roll. */
export async function getSchoolClasses(
  supabase: SupabaseClient<Database>,
  schoolId: string,
): Promise<SchoolClasses> {
  const { data, error } = await supabase
    .from('students')
    .select('class_grade, section')
    .eq('school_id', schoolId)
    .eq('is_active', true);

  if (error) console.error('[classes] lookup failed', { error: error.message });

  const map = new Map<string, Set<string>>();
  for (const row of data ?? []) {
    const set = map.get(row.class_grade) ?? new Set<string>();
    set.add(row.section);
    map.set(row.class_grade, set);
  }

  const grades = [...map.keys()].sort((a, b) => gradeRank(a) - gradeRank(b));
  return {
    grades,
    sectionsByGrade: Object.fromEntries(grades.map((grade) => [grade, [...(map.get(grade) ?? [])].sort()])),
  };
}

/** "Class IX", "Class IX-A", or "Whole school". */
export function audienceLabel(grade: string | null, section: string | null): string {
  if (!grade) return 'Whole school';
  return section ? `Class ${grade}-${section}` : `Class ${grade}`;
}
