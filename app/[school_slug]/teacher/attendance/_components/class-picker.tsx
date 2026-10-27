'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { LayoutList, UserSquare2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type AttendanceView = 'rollcall' | 'list';

interface ClassPickerProps {
  schoolSlug: string;
  academicYears: string[];
  selectedYear: string;
  grades: string[];
  sections: string[];
  selectedGrade: string | null;
  selectedSection: string | null;
  selectedDate: string;
  minDate: string;
  maxDate: string;
  view: AttendanceView;
}

/**
 * Academic year, class, section and date. Selection lives in the URL so a
 * teacher can bookmark their own class, and the server component re-fetches
 * the roster on navigation. The year bounds the date picker to 1 April to
 * 31 March, and never beyond today.
 */
export function ClassPicker({
  academicYears,
  selectedYear,
  grades,
  sections,
  selectedGrade,
  selectedSection,
  selectedDate,
  minDate,
  maxDate,
  view,
}: ClassPickerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = React.useTransition();

  function hrefWith(updates: Record<string, string>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    return `${pathname}?${next.toString()}`;
  }

  function navigate(updates: Record<string, string>) {
    startTransition(() => {
      router.replace(hrefWith(updates), { scroll: false });
    });
  }

  return (
    <Card>
      <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1.5">
          <Label htmlFor="year">Academic year</Label>
          <Select value={selectedYear} onValueChange={(value) => navigate({ year: value, date: '' })}>
            <SelectTrigger id="year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {academicYears.map((year) => (
                <SelectItem key={year} value={year}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="grade">Class</Label>
          <Select
            value={selectedGrade ?? undefined}
            onValueChange={(value) => navigate({ grade: value, section: '' })}
          >
            <SelectTrigger id="grade">
              <SelectValue placeholder="Select class" />
            </SelectTrigger>
            <SelectContent>
              {grades.map((grade) => (
                <SelectItem key={grade} value={grade}>
                  Class {grade}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="section">Section</Label>
          <Select
            value={selectedSection ?? undefined}
            onValueChange={(value) => navigate({ section: value })}
          >
            <SelectTrigger id="section">
              <SelectValue placeholder="Select section" />
            </SelectTrigger>
            <SelectContent>
              {sections.map((section) => (
                <SelectItem key={section} value={section}>
                  Section {section}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="date">Date</Label>
          <Input
            id="date"
            type="date"
            value={selectedDate}
            min={minDate}
            max={maxDate}
            onChange={(event) => navigate({ date: event.target.value })}
          />
        </div>

        <div
          role="tablist"
          aria-label="Attendance view"
          className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm font-medium sm:col-span-2 lg:col-span-4"
        >
          {(
            [
              { value: 'rollcall', label: 'Roll call', icon: UserSquare2 },
              { value: 'list', label: 'Class list', icon: LayoutList },
            ] as const
          ).map(({ value, label, icon: Icon }) => (
            <Link
              key={value}
              role="tab"
              aria-selected={view === value}
              replace
              scroll={false}
              href={hrefWith({ view: value === 'rollcall' ? '' : value })}
              className={cn(
                'flex items-center justify-center gap-2 rounded-md px-3 py-1.5 transition-colors',
                view === value ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
