'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { BookOpenCheck, CalendarCheck, CalendarOff, Megaphone, NotebookPen } from 'lucide-react';
import { cn } from '@/lib/utils';

const ITEMS = [
  { segment: 'attendance', label: 'Attendance', icon: CalendarCheck },
  { segment: 'announcements', label: 'Announcements', icon: Megaphone },
  { segment: 'homework', label: 'Homework & videos', icon: NotebookPen },
  { segment: 'exams', label: 'Exams & syllabus', icon: BookOpenCheck },
  { segment: 'leave', label: 'Leave', icon: CalendarOff },
] as const;

export function StaffNav({ schoolSlug }: { schoolSlug: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Staff tools" className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-2 sm:px-4">
      {ITEMS.map(({ segment, label, icon: Icon }) => {
        const href = `/${schoolSlug}/teacher/${segment}`;
        const active = pathname.startsWith(href);
        return (
          <Link
            key={segment}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex shrink-0 items-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
            {active ? (
              <motion.span
                layoutId="staff-nav-underline"
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
