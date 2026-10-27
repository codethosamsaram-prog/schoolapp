import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireTenantSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { CLASS_GRADES, SECTIONS } from '@/lib/constants';
import { loadIdCardData, MAX_CARDS_PER_BATCH, qrDataUrl } from '@/lib/id-cards';
import { signedUrls } from '@/lib/storage';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { IdCardPicker } from './_components/id-card-picker';

export const metadata: Metadata = { title: 'Student ID cards' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: { school_slug: string };
  searchParams: { grade?: string; section?: string };
}

const selectClass =
  'h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default async function IdCardsPage({ params, searchParams }: PageProps) {
  const { school } = await requireTenantSession(params.school_slug, ['SUPER_ADMIN', 'SCHOOL_ADMIN']);

  const grade = (CLASS_GRADES as readonly string[]).includes(searchParams.grade ?? '')
    ? (searchParams.grade as string)
    : null;
  const section = (SECTIONS as readonly string[]).includes(searchParams.section ?? '')
    ? (searchParams.section as string)
    : null;

  const supabase = createClient();
  const data = grade && section ? await loadIdCardData(supabase, school.id, { grade, section }) : null;

  const cards = data
    ? await (async () => {
        const photos = await signedUrls(
          supabase,
          'avatars',
          data.students.map((student) => student.avatarPath),
        );
        return Promise.all(
          data.students.map(async (student) => ({
            ...student,
            photoUrl: student.avatarPath ? (photos.get(student.avatarPath) ?? null) : null,
            qrUrl: await qrDataUrl(student.id),
          })),
        );
      })()
    : [];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 lg:px-8 lg:py-8">
      <header className="space-y-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/${school.slug}/admin/students`}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Students
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">Student ID cards</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Print a class section at a time. Each card&apos;s front and back sit side by side, four
          students to an A4 page, ready to cut, fold and laminate. The QR code holds the student&apos;s
          record id only.
        </p>
      </header>

      <form method="get" className="flex flex-wrap items-center gap-2">
        <select name="grade" defaultValue={grade ?? ''} className={selectClass} aria-label="Class" required>
          <option value="" disabled>
            Class
          </option>
          {CLASS_GRADES.map((value) => (
            <option key={value} value={value}>
              Class {value}
            </option>
          ))}
        </select>
        <select
          name="section"
          defaultValue={section ?? ''}
          className={selectClass}
          aria-label="Section"
          required
        >
          <option value="" disabled>
            Section
          </option>
          {SECTIONS.map((value) => (
            <option key={value} value={value}>
              Section {value}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary">
          Show cards
        </Button>
      </form>

      {!grade || !section ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Choose a class and section to preview its ID cards.
          </CardContent>
        </Card>
      ) : cards.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No active students in Class {grade}-{section}.
          </CardContent>
        </Card>
      ) : (
        <>
          {cards.length === MAX_CARDS_PER_BATCH ? (
            <p className="text-sm text-amber-700">
              Showing the first {MAX_CARDS_PER_BATCH} students; print this section in two batches.
            </p>
          ) : null}
          <IdCardPicker school={data!.school} grade={grade} section={section} cards={cards} />
        </>
      )}
    </div>
  );
}
