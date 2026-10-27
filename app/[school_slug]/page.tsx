import { notFound } from 'next/navigation';
import Image from 'next/image';
import {
  BookOpenCheck,
  Bus,
  FlaskConical,
  Landmark,
  Mail,
  MapPin,
  Phone,
  Trophy,
  Wifi,
} from 'lucide-react';
import type { FeeStructure } from '@/types/database';
import { createAnonClient } from '@/lib/supabase/server';
import { getSchoolBySlug } from '@/lib/auth';
import { formatDate, formatINR } from '@/lib/utils';
import { CLASS_GRADES } from '@/lib/constants';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AdmissionDialog } from './_components/admission-dialog';

// The portal is public, cacheable content; fee changes land within five minutes.
export const revalidate = 300;

interface PageProps {
  params: { school_slug: string };
}

const INFRASTRUCTURE = [
  {
    icon: FlaskConical,
    title: 'Science and computer labs',
    body: 'Physics, chemistry and biology labs plus two computer labs with one machine per student.',
  },
  {
    icon: BookOpenCheck,
    title: 'Library',
    body: 'Over 18,000 titles across English, Hindi and regional languages, with a dedicated reading hall.',
  },
  {
    icon: Trophy,
    title: 'Sports complex',
    body: 'Cricket and football grounds, a basketball court, and coaching for athletics and table tennis.',
  },
  {
    icon: Bus,
    title: 'Transport',
    body: 'GPS-tracked buses on 22 routes, with an attendant on every bus and live updates to parents.',
  },
  {
    icon: Wifi,
    title: 'Smart classrooms',
    body: 'Every classroom is air-cooled with an interactive panel and campus-wide Wi-Fi.',
  },
  {
    icon: Landmark,
    title: 'Auditorium',
    body: 'A 700-seat auditorium for assemblies, cultural events and parent-teacher conferences.',
  },
] as const;

function groupFeesByGrade(fees: FeeStructure[]): Map<string, FeeStructure[]> {
  const grouped = new Map<string, FeeStructure[]>();
  for (const fee of fees) {
    const bucket = grouped.get(fee.class_grade);
    if (bucket) bucket.push(fee);
    else grouped.set(fee.class_grade, [fee]);
  }

  // Present grades in academic progression, not alphabetically.
  const order = new Map(CLASS_GRADES.map((grade, index) => [grade as string, index]));
  return new Map(
    [...grouped.entries()].sort(
      ([a], [b]) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER),
    ),
  );
}

export default async function SchoolPortalPage({ params }: PageProps) {
  const school = await getSchoolBySlug(params.school_slug);
  if (!school) notFound();

  const supabase = createAnonClient();
  const { data: feeRows, error: feeError } = await supabase
    .from('fee_structures')
    .select('*')
    .eq('school_id', school.id)
    .order('class_grade', { ascending: true })
    .order('due_date', { ascending: true });

  if (feeError) {
    console.error('[portal] failed to load fee schedule', {
      slug: params.school_slug,
      error: feeError.message,
    });
  }

  const fees: FeeStructure[] = feeRows ?? [];
  const feesByGrade = groupFeesByGrade(fees);
  const academicYear = fees[0]?.academic_year ?? null;
  const addressLine = [school.address, school.city, school.state, school.pincode]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="min-h-screen bg-background">
      {/* ---------------------------------------------------------------- nav */}
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {school.logo_url ? (
              <Image
                src={school.logo_url}
                alt={`${school.name} logo`}
                width={44}
                height={44}
                className="h-11 w-11 rounded-md object-contain"
              />
            ) : (
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
                {school.name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight sm:text-base">
                {school.name}
              </p>
              {school.board ? (
                <p className="text-xs text-muted-foreground">{school.board} affiliated</p>
              ) : null}
            </div>
          </div>

          <nav className="flex items-center gap-2">
            <a
              href="#fees"
              className="hidden text-sm font-medium text-muted-foreground hover:text-foreground sm:block"
            >
              Fee schedule
            </a>
            <a
              href="#contact"
              className="hidden text-sm font-medium text-muted-foreground hover:text-foreground sm:block"
            >
              Contact
            </a>
            <AdmissionDialog
              schoolSlug={school.slug}
              schoolName={school.name}
              size="default"
              triggerLabel="Apply now"
              autoOpenHash="apply"
            />
          </nav>
        </div>
      </header>

      {/* --------------------------------------------------------------- hero */}
      <section className="border-b bg-gradient-to-b from-primary/10 via-background to-background">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:py-20">
          <div className="space-y-6">
            {school.established_year ? (
              <Badge variant="outline" className="border-primary/30 text-primary">
                Established {school.established_year}
              </Badge>
            ) : null}

            <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
              {school.name}
            </h1>

            <p className="max-w-xl text-lg text-muted-foreground">
              {school.tagline ??
                'A campus built for curiosity, with teachers who know every student by name.'}
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <AdmissionDialog schoolSlug={school.slug} schoolName={school.name} />
              {school.contact_phone ? (
                <a
                  href={`tel:${school.contact_phone.replace(/\s/g, '')}`}
                  className="inline-flex h-11 items-center gap-2 rounded-md border px-5 text-sm font-medium hover:bg-accent"
                >
                  <Phone className="h-4 w-4" aria-hidden />
                  {school.contact_phone}
                </a>
              ) : null}
            </div>

            <dl className="grid max-w-lg grid-cols-3 gap-4 border-t pt-6">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Board</dt>
                <dd className="mt-1 text-lg font-semibold">{school.board ?? 'CBSE'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Grades</dt>
                <dd className="mt-1 text-lg font-semibold">
                  {feesByGrade.size > 0 ? `${[...feesByGrade.keys()][0]} to ${[...feesByGrade.keys()].at(-1)}` : 'Nursery to XII'}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Session</dt>
                <dd className="mt-1 text-lg font-semibold">{academicYear ?? 'Open'}</dd>
              </div>
            </dl>
          </div>

          <div className="relative aspect-[4/3] overflow-hidden rounded-xl border bg-muted">
            {school.hero_image_url ? (
              <Image
                src={school.hero_image_url}
                alt={`${school.name} campus`}
                fill
                sizes="(max-width: 1024px) 100vw, 45vw"
                className="object-cover"
                priority
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-primary/10 text-center text-sm text-muted-foreground">
                Campus photography appears here once the school uploads it.
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------- infrastructure */}
      <section className="mx-auto max-w-6xl px-4 py-14" id="campus">
        <div className="mb-8 max-w-2xl space-y-2">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Campus and facilities</h2>
          <p className="text-muted-foreground">
            Everything a student needs on one campus, maintained and supervised through the day.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {INFRASTRUCTURE.map(({ icon: Icon, title, body }) => (
            <Card key={title} className="transition-shadow hover:shadow-md">
              <CardHeader className="space-y-3 pb-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <CardTitle className="text-base">{title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-relaxed text-muted-foreground">
                {body}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------- fee schedule */}
      <section className="border-y bg-muted/40" id="fees">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl space-y-2">
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Fee schedule</h2>
              <p className="text-muted-foreground">
                Published fees for the {academicYear ?? 'current'} session. All payments are
                collected online over UPI or netbanking, and a receipt reaches you on WhatsApp.
              </p>
            </div>
            {academicYear ? <Badge variant="secondary">Session {academicYear}</Badge> : null}
          </div>

          {feesByGrade.size === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                The fee schedule for this session has not been published yet. Please contact the
                school office.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              {[...feesByGrade.entries()].map(([grade, gradeFees]) => {
                const total = gradeFees.reduce((sum, fee) => sum + Number(fee.amount), 0);

                return (
                  <Card key={grade} className="overflow-hidden">
                    <CardHeader className="flex-row items-center justify-between space-y-0 border-b bg-background py-4">
                      <CardTitle className="text-base">Class {grade}</CardTitle>
                      <span className="text-sm font-semibold text-primary">
                        {formatINR(total)} / year
                      </span>
                    </CardHeader>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Particulars</TableHead>
                            <TableHead>Due date</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {gradeFees.map((fee) => (
                            <TableRow key={fee.id}>
                              <TableCell className="font-medium">
                                {fee.title}
                                {fee.description ? (
                                  <span className="block text-xs font-normal text-muted-foreground">
                                    {fee.description}
                                  </span>
                                ) : null}
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-muted-foreground">
                                {formatDate(fee.due_date)}
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-right font-semibold">
                                {formatINR(fee.amount)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------ contact */}
      <section className="mx-auto max-w-6xl px-4 py-14" id="contact">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:items-start">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Visit or call us</h2>
            <p className="text-muted-foreground">
              The admissions desk is open Monday to Saturday, 9:00 AM to 4:00 PM. Walk in, or send
              an enquiry and we will call you back.
            </p>
            <div className="pt-4">
              <AdmissionDialog
                schoolSlug={school.slug}
                schoolName={school.name}
                triggerLabel="Start an admission enquiry"
              />
            </div>
          </div>

          <Card>
            <CardContent className="grid gap-5 p-6 sm:grid-cols-2">
              <div className="flex gap-3">
                <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Address</p>
                  <p className="text-sm text-muted-foreground">
                    {addressLine || 'Address available on request'}
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <Phone className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Phone</p>
                  {school.contact_phone ? (
                    <a
                      href={`tel:${school.contact_phone.replace(/\s/g, '')}`}
                      className="text-sm text-muted-foreground hover:text-foreground"
                    >
                      {school.contact_phone}
                    </a>
                  ) : (
                    <p className="text-sm text-muted-foreground">Available on request</p>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                <Mail className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Email</p>
                  {school.contact_email ? (
                    <a
                      href={`mailto:${school.contact_email}`}
                      className="break-all text-sm text-muted-foreground hover:text-foreground"
                    >
                      {school.contact_email}
                    </a>
                  ) : (
                    <p className="text-sm text-muted-foreground">Available on request</p>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Affiliation</p>
                  <p className="text-sm text-muted-foreground">
                    {school.board ?? 'Details available at the office'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ------------------------------------------------------------- footer */}
      <footer className="border-t bg-muted/30">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            &copy; {new Date().getFullYear()} {school.name}. All rights reserved.
          </p>
          <p>Powered by ClassroomOS</p>
        </div>
      </footer>
    </div>
  );
}
