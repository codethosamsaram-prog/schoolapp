import { GraduationCap, MessageSquare, ShieldCheck, Wallet } from 'lucide-react';
import { listActiveSchools } from '@/lib/schools';
import { FadeIn } from '@/components/motion';
import { RoleEntry } from './_components/role-entry';

// The school list changes rarely; refresh it every ten minutes.
export const revalidate = 600;

const FEATURES = [
  {
    icon: Wallet,
    title: 'Fees on UPI',
    body: 'Razorpay payments, instant PDF receipts and office collections in one ledger.',
  },
  {
    icon: MessageSquare,
    title: 'WhatsApp for parents',
    body: 'Admission replies, payment confirmations and absence alerts where parents already are.',
  },
  {
    icon: ShieldCheck,
    title: 'Private by design',
    body: 'Row Level Security keeps every school, class and family in its own lane.',
  },
] as const;

export default async function Home() {
  const schools = await listActiveSchools();

  return (
    <main className="relative min-h-screen overflow-hidden bg-muted/30">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[480px] bg-gradient-to-b from-primary/10 via-primary/5 to-transparent"
      />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-12 px-4 py-16">
        <FadeIn className="max-w-3xl space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
            <GraduationCap className="h-4 w-4 text-primary" aria-hidden />
            {schools.length > 0
              ? `${schools.length} school${schools.length === 1 ? '' : 's'} on ClassroomOS`
              : 'School & college ERP for India'}
          </div>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Welcome to <span className="text-primary">ClassroomOS</span>
          </h1>
          <p className="text-lg text-muted-foreground">
            One place for students, parents and staff: attendance, homework, results, fees and school
            news. Choose how you are signing in today.
          </p>
        </FadeIn>

        <RoleEntry schools={schools} />

        <FadeIn delay={0.35}>
          <section className="grid gap-6 border-t pt-10 sm:grid-cols-3" aria-label="Platform features">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-3">
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                <div>
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="text-sm text-muted-foreground">{body}</p>
                </div>
              </div>
            ))}
          </section>
        </FadeIn>
      </div>
    </main>
  );
}
