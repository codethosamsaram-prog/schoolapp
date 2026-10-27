'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Backpack, BriefcaseBusiness, FilePenLine, type LucideIcon } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SchoolCombobox, type SchoolOption } from '@/components/school-combobox';
import { cn } from '@/lib/utils';

interface RoleCardProps {
  icon: LucideIcon;
  title: string;
  body: string;
  cta: string;
  accent: string;
  index: number;
}

function RoleCardBody({ icon: Icon, title, body, cta, accent }: Omit<RoleCardProps, 'index'>) {
  return (
    <div className="flex h-full flex-col gap-4 rounded-2xl border bg-background p-6 text-left shadow-sm transition-shadow group-hover:shadow-lg">
      <span className={cn('flex h-12 w-12 items-center justify-center rounded-xl', accent)}>
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <div className="flex-1 space-y-1.5">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
      <span className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
        {cta}
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
      </span>
    </div>
  );
}

/**
 * CSS entrance (visible without JavaScript) plus a Framer hover lift, which
 * has no initial state and so never hides the card before hydration.
 */
function Animated({ index, children }: { index: number; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <div
      className="h-full animate-in fade-in-0 slide-in-from-bottom-4 duration-500 ease-out fill-mode-both motion-reduce:animate-none"
      style={{ animationDelay: `${0.1 + index * 0.08}s` }}
    >
      <motion.div className="h-full" whileHover={reduce ? undefined : { y: -4 }}>
        {children}
      </motion.div>
    </div>
  );
}

/** The three ways into ClassroomOS from the platform home page. */
export function RoleEntry({ schools }: { schools: SchoolOption[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [school, setSchool] = React.useState<SchoolOption | null>(null);

  const cards = [
    {
      key: 'student',
      href: '/login?role=student',
      icon: Backpack,
      title: 'I am a Student / Parent',
      body: 'Homework, results, hall tickets, attendance and fee payments for your child.',
      cta: 'Sign in',
      accent: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
    },
    {
      key: 'staff',
      href: '/login?role=staff',
      icon: BriefcaseBusiness,
      title: 'I am a Staff Member',
      body: 'Roll-call attendance, announcements, homework, marks and the admin console.',
      cta: 'Staff sign in',
      accent: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
    },
  ] as const;

  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        {cards.map(({ key, href, ...card }, index) => (
          <Animated key={key} index={index}>
            <Link href={href} className="group block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <RoleCardBody {...card} />
            </Link>
          </Animated>
        ))}
        <Animated index={2}>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="group block h-full w-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RoleCardBody
              icon={FilePenLine}
              title="New Admission / Enquiry"
              body="Find a school, see its fees and campus, and send an admission enquiry."
              cta="Find a school"
              accent="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
            />
          </button>
        </Animated>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Which school are you applying to?</DialogTitle>
            <DialogDescription>
              Search by name or city. You will go to the school&apos;s page with the admission form open.
            </DialogDescription>
          </DialogHeader>
          <SchoolCombobox
            id="admission-school"
            inline
            autoFocus
            schools={schools}
            value={school}
            onChange={(chosen) => {
              setSchool(chosen);
              router.push(`/${chosen.slug}#apply`);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
