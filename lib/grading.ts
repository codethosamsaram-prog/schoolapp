/**
 * CBSE-style nine-point grading, used when a result row has no grade of its
 * own. A pass is 33% of the maximum; grade points feed a 10-point GPA.
 */

export const PASS_PERCENT = 33;

const BANDS = [
  { min: 91, grade: 'A1', points: 10 },
  { min: 81, grade: 'A2', points: 9 },
  { min: 71, grade: 'B1', points: 8 },
  { min: 61, grade: 'B2', points: 7 },
  { min: 51, grade: 'C1', points: 6 },
  { min: 41, grade: 'C2', points: 5 },
  { min: 33, grade: 'D', points: 4 },
  { min: 0, grade: 'E', points: 0 },
] as const;

export interface GradeResult {
  percent: number;
  grade: string;
  points: number;
  passed: boolean;
}

export function gradeFor(marks: number, maxMarks: number): GradeResult {
  const percent = maxMarks > 0 ? (marks / maxMarks) * 100 : 0;
  const band = BANDS.find((entry) => percent >= entry.min) ?? BANDS[BANDS.length - 1];
  return {
    percent: Math.round(percent * 10) / 10,
    grade: band.grade,
    points: band.points,
    passed: percent >= PASS_PERCENT,
  };
}

/** Mean grade points across subjects, to one decimal. */
export function gpa(results: { marks: number; maxMarks: number }[]): number | null {
  if (results.length === 0) return null;
  const total = results.reduce((sum, r) => sum + gradeFor(r.marks, r.maxMarks).points, 0);
  return Math.round((total / results.length) * 10) / 10;
}
