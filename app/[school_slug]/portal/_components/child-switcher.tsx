'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StudentAvatar } from '@/components/student-avatar';
import { useToast } from '@/components/ui/use-toast';
import { setActiveStudent } from '../actions';

interface SwitcherStudent {
  id: string;
  fullName: string;
  classLabel: string;
  photoUrl: string | null;
}

interface ChildSwitcherProps {
  schoolSlug: string;
  activeId: string;
  students: SwitcherStudent[];
}

/** Shows the selected child; with siblings, it becomes a switcher. */
export function ChildSwitcher({ schoolSlug, activeId, students }: ChildSwitcherProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();
  const active = students.find((student) => student.id === activeId) ?? students[0];

  const summary = (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <StudentAvatar src={active.photoUrl} name={active.fullName} className="h-9 w-9 text-xs" />
      <span className="min-w-0 text-left">
        <span className="block truncate text-sm font-semibold">{active.fullName}</span>
        <span className="block text-xs text-muted-foreground">{active.classLabel}</span>
      </span>
    </span>
  );

  if (students.length < 2) {
    return <div className="flex items-center rounded-lg border bg-muted/40 p-2">{summary}</div>;
  }

  function choose(id: string) {
    if (id === activeId) return;
    startTransition(async () => {
      const result = await setActiveStudent(schoolSlug, id);
      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Could not switch', description: result.error });
        return;
      }
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2 rounded-lg border bg-muted/40 p-2 hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Viewing ${active.fullName}. Switch child`}
      >
        {summary}
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <ChevronsUpDown className="h-4 w-4 text-muted-foreground" aria-hidden />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
        <DropdownMenuLabel>Switch child</DropdownMenuLabel>
        {students.map((student) => (
          <DropdownMenuItem key={student.id} onSelect={() => choose(student.id)} className="gap-3">
            <StudentAvatar src={student.photoUrl} name={student.fullName} className="h-7 w-7 text-[10px]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{student.fullName}</span>
              <span className="block text-xs text-muted-foreground">{student.classLabel}</span>
            </span>
            {student.id === activeId ? <Check className="h-4 w-4 text-primary" aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
