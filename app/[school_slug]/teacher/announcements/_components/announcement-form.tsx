'use client';

import * as React from 'react';
import { Loader2, Megaphone } from 'lucide-react';
import type { AnnouncementTarget } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { createAnnouncement } from '../../content-actions';
import { ClassFields } from '../../_components/class-fields';

interface AnnouncementFormProps {
  schoolSlug: string;
  grades: string[];
  sectionsByGrade: Record<string, string[]>;
}

const TARGETS: { value: AnnouncementTarget; label: string }[] = [
  { value: 'ALL', label: 'Whole school' },
  { value: 'CLASS', label: 'A class' },
  { value: 'SECTION', label: 'A section' },
];

export function AnnouncementForm({ schoolSlug, grades, sectionsByGrade }: AnnouncementFormProps) {
  const [target, setTarget] = React.useState<AnnouncementTarget>('ALL');
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [pending, startTransition] = React.useTransition();
  const { toast } = useToast();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.set('targetType', target);
    setErrors({});

    startTransition(async () => {
      const result = await createAnnouncement(schoolSlug, formData);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast({ variant: 'destructive', title: 'Not posted', description: result.error });
        return;
      }
      toast({ variant: 'success', title: 'Announcement posted' });
      form.reset();
      setTarget('ALL');
    });
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Send to</legend>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 text-sm font-medium">
          {TARGETS.map((option) => (
            <label
              key={option.value}
              className={cn(
                'cursor-pointer rounded-md px-2 py-1.5 text-center transition-colors',
                target === option.value ? 'bg-background shadow-sm' : 'text-muted-foreground',
              )}
            >
              <input
                type="radio"
                name="target"
                value={option.value}
                checked={target === option.value}
                onChange={() => setTarget(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      {target !== 'ALL' ? (
        <div className={cn('grid gap-4', target === 'SECTION' ? 'grid-cols-2' : 'grid-cols-1')}>
          {target === 'SECTION' ? (
            <ClassFields
              idPrefix="announce"
              grades={grades}
              sectionsByGrade={sectionsByGrade}
              allowAllSections={false}
              gradeName="targetGrade"
              sectionName="targetSection"
              errors={errors}
            />
          ) : (
            <div className="grid gap-2">
              <Label htmlFor="announce-class">Class</Label>
              <select
                id="announce-class"
                name="targetGrade"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {grades.map((grade) => (
                  <option key={grade} value={grade}>
                    Class {grade}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor="announce-title">Title</Label>
        <Input id="announce-title" name="title" maxLength={150} required />
        {errors.title?.[0] ? <p className="text-xs text-destructive">{errors.title[0]}</p> : null}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="announce-content">Message</Label>
        <Textarea id="announce-content" name="content" rows={5} maxLength={5000} required />
        {errors.content?.[0] ? <p className="text-xs text-destructive">{errors.content[0]}</p> : null}
      </div>

      <Button type="submit" disabled={pending} className="justify-self-start">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Megaphone className="h-4 w-4" aria-hidden />}
        Post announcement
      </Button>
    </form>
  );
}
