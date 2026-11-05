'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  BookMarked,
  CalendarDays,
  Home,
  IndianRupee,
  NotebookPen,
  Trophy,
  UserRound,
  type LucideIcon,
  CalendarOff,
  Bell,
  QrCode,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface Group {
  label: string;
  items: Item[];
}

const GROUPS: Group[] = [
  {
    label: 'Overview',
    items: [
      { href: '', label: 'Home', icon: Home },
      { href: '/notifications', label: 'Notifications', icon: Bell },
    ],
  },
  {
    label: 'Academic hub',
    items: [
      { href: '/homework', label: 'Homework', icon: NotebookPen },
      { href: '/syllabus', label: 'Syllabus', icon: BookMarked },
      { href: '/calendar', label: 'Holiday calendar', icon: CalendarDays },
    ],
  },
  { label: 'Exams & performance', items: [{ href: '/exams', label: 'Hall tickets & results', icon: Trophy }] },
  {
    label: 'Fees & payments',
    items: [
      { href: '/fees', label: 'Fees & receipts', icon: IndianRupee },
      { href: '/pay-upi', label: 'Pay by UPI', icon: QrCode },
    ],
  },
  {
    label: 'Personal',
    items: [
      { href: '/profile', label: 'My details', icon: UserRound },
      { href: '/leave', label: 'Leave', icon: CalendarOff },
    ],
  },
];

export function PortalNav({ schoolSlug }: { schoolSlug: string }) {
  const pathname = usePathname();
  const base = `/${schoolSlug}/portal`;

  function isActive(href: string) {
    return href === '' ? pathname === base : pathname.startsWith(`${base}${href}`);
  }

  return (
    <nav aria-label="Portal" className="px-2 pb-2 lg:px-3">
      {/* Phones: one scrolling row. */}
      <ul className="flex gap-1 overflow-x-auto lg:hidden">
        {GROUPS.flatMap((group) => group.items).map(({ href, label, icon: Icon }) => (
          <li key={href} className="shrink-0">
            <Link
              href={`${base}${href}`}
              aria-current={isActive(href) ? 'page' : undefined}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium',
                isActive(href) ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </Link>
          </li>
        ))}
      </ul>

      {/* Desktop: grouped sidebar. */}
      <div className="hidden space-y-4 lg:block">
        {GROUPS.map((group) => (
          <div key={group.label}>
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map(({ href, label, icon: Icon }) => {
                const active = isActive(href);
                return (
                  <li key={href}>
                    <Link
                      href={`${base}${href}`}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'relative flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                        active ? 'text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                    >
                      {active ? (
                        <motion.span
                          layoutId="portal-nav-active"
                          className="absolute inset-0 rounded-md bg-primary/10"
                          transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                        />
                      ) : null}
                      <Icon className="relative h-4 w-4" aria-hidden />
                      <span className="relative">{label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
