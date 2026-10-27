/* eslint-disable @next/next/no-img-element -- signed photo URLs and QR data URLs; next/image adds nothing */
import type { IdCardSchool, IdCardStudent } from '@/lib/id-cards';
import { StudentAvatar } from '@/components/student-avatar';

export interface PreviewCard extends IdCardStudent {
  photoUrl: string | null;
  qrUrl: string;
}

/**
 * On-screen twin of the PDF card in components/pdf/IdCardsPDF.tsx, at the
 * same 85.6 x 54 aspect ratio, so what the admin selects is what prints.
 */
export function IdCardPreview({ school, card }: { school: IdCardSchool; card: PreviewCard }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2" data-student-id={card.id}>
      <div
        className="flex aspect-[85.6/54] flex-col overflow-hidden rounded-lg border bg-white text-slate-900 shadow-sm"
        aria-label={`Front of ${card.fullName}'s card`}
      >
        <div className="px-3 py-1.5 text-white" style={{ backgroundColor: school.color }}>
          <p className="truncate text-xs font-bold">{school.name}</p>
          <p className="text-[9px] tracking-wide opacity-90">STUDENT IDENTITY CARD · {school.academicYear}</p>
        </div>
        <div className="flex min-h-0 flex-1 items-center gap-3 p-3">
          <StudentAvatar src={card.photoUrl} name={card.fullName} className="h-20 w-16 rounded-md text-base" />
          <div className="min-w-0 flex-1 space-y-0.5 text-[11px] leading-tight">
            <p className="truncate text-sm font-bold">{card.fullName}</p>
            <p>
              <span className="text-slate-500">Class</span> {card.classGrade} - {card.section} ·{' '}
              <span className="text-slate-500">Roll</span> {card.rollNumber}
            </p>
            {card.usn ? (
              <p>
                <span className="text-slate-500">USN</span> {card.usn}
              </p>
            ) : null}
            <p className="mt-1 inline-block rounded border border-rose-700 px-1 font-bold text-rose-700">
              Blood group {card.bloodGroup ?? '-'}
            </p>
          </div>
          <img src={card.qrUrl} alt={`QR code for ${card.fullName}`} className="h-16 w-16 shrink-0" />
        </div>
      </div>

      <div
        className="flex aspect-[85.6/54] flex-col overflow-hidden rounded-lg border bg-white text-slate-900 shadow-sm"
        aria-label={`Back of ${card.fullName}'s card`}
      >
        <div className="h-1.5" style={{ backgroundColor: school.color }} />
        <div className="flex flex-1 flex-col justify-around p-3 text-[11px] leading-snug">
          <div>
            <p className="font-bold">In an emergency, call</p>
            <p>{card.parentName ?? 'Parent / guardian'}</p>
            <p className="text-xs font-bold">+91 {card.parentPhone}</p>
          </div>
          <div>
            <p className="font-bold">If found, please return to</p>
            <p className="truncate">{school.name}</p>
            <p className="line-clamp-2 text-slate-600">{school.addressLine}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
