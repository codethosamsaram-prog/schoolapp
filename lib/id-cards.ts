import 'server-only';

import QRCode from 'qrcode';
import type { BloodGroup } from '@/types/database';
import type { createClient } from '@/lib/supabase/server';

/**
 * Data for student ID cards, shared by the admin preview and the PDF route so
 * both print exactly the same thing. Reads run on the caller's session: RLS
 * decides which students exist for them.
 *
 * The QR code encodes the student's id and nothing else. It identifies a
 * record for someone who can already look it up; it carries no personal data.
 */

/** Caps one PDF, which is rendered in a single request. */
export const MAX_CARDS_PER_BATCH = 120;

const QR_OPTIONS = { errorCorrectionLevel: 'M', margin: 1, width: 240 } as const;

export interface IdCardStudent {
  id: string;
  fullName: string;
  rollNumber: string;
  usn: string | null;
  admissionNumber: string | null;
  classGrade: string;
  section: string;
  bloodGroup: BloodGroup | null;
  dateOfBirth: string | null;
  parentName: string | null;
  parentPhone: string;
  avatarPath: string | null;
}

export interface IdCardSchool {
  name: string;
  addressLine: string;
  phone: string | null;
  color: string;
  academicYear: string;
}

type SessionClient = ReturnType<typeof createClient>;

export async function loadIdCardData(
  supabase: SessionClient,
  schoolId: string,
  filter: { grade: string; section: string; studentIds?: string[] },
): Promise<{ school: IdCardSchool; students: IdCardStudent[] } | null> {
  let query = supabase
    .from('students')
    .select(
      'id, full_name, roll_number, usn, admission_number, class_grade, section, blood_group, date_of_birth, parent_name, parent_phone, avatar_url',
    )
    .eq('school_id', schoolId)
    .eq('class_grade', filter.grade)
    .eq('section', filter.section)
    .eq('is_active', true)
    .limit(MAX_CARDS_PER_BATCH);
  if (filter.studentIds) query = query.in('id', filter.studentIds);

  const [{ data: rows }, { data: school }, { data: academicYear }] = await Promise.all([
    query,
    supabase
      .from('schools')
      .select('name, address, city, state, pincode, contact_phone, primary_color')
      .eq('id', schoolId)
      .maybeSingle(),
    supabase.rpc('current_academic_year'),
  ]);
  if (!school) return null;

  const students = (rows ?? [])
    .map(
      (row): IdCardStudent => ({
        id: row.id,
        fullName: row.full_name,
        rollNumber: row.roll_number,
        usn: row.usn,
        admissionNumber: row.admission_number,
        classGrade: row.class_grade,
        section: row.section,
        bloodGroup: row.blood_group,
        dateOfBirth: row.date_of_birth,
        parentName: row.parent_name,
        parentPhone: row.parent_phone,
        avatarPath: row.avatar_url,
      }),
    )
    .sort((a, b) => a.rollNumber.localeCompare(b.rollNumber, undefined, { numeric: true }));

  return {
    school: {
      name: school.name,
      addressLine: [school.address, school.city, school.state, school.pincode].filter(Boolean).join(', '),
      phone: school.contact_phone,
      color: school.primary_color ?? '#1d4ed8',
      academicYear: academicYear ?? '',
    },
    students,
  };
}

export function qrDataUrl(studentId: string): Promise<string> {
  return QRCode.toDataURL(studentId, QR_OPTIONS);
}

export function qrPng(studentId: string): Promise<Buffer> {
  return QRCode.toBuffer(studentId, QR_OPTIONS);
}
