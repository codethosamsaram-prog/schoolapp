'use client';

import * as React from 'react';
import { CalendarPlus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { createHoliday } from '../../teacher/content-actions';

export function HolidayForm({ schoolSlug }: { schoolSlug: string }) {
  const [pending, startTransition] = React.useTransition();
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const { toast } = useToast();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setErrors({});

    startTransition(async () => {
      const result = await createHoliday(schoolSlug, formData);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast({ variant: 'destructive', title: 'Not added', description: result.error });
        return;
      }
      toast({ variant: 'success', title: `${String(formData.get('title'))} added` });
      form.reset();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
      <div className="grid gap-2">
        <Label htmlFor="holiday-title">Name</Label>
        <Input id="holiday-title" name="title" placeholder="Diwali" maxLength={120} required />
        {errors.title?.[0] ? <p className="text-xs text-destructive">{errors.title[0]}</p> : null}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="holiday-date">Date</Label>
        <Input id="holiday-date" name="date" type="date" required />
        {errors.date?.[0] ? <p className="text-xs text-destructive">{errors.date[0]}</p> : null}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="holiday-description">Note</Label>
        <Input id="holiday-description" name="description" placeholder="Optional" maxLength={300} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isAcademicHoliday" defaultChecked className="h-4 w-4" />
        School is closed (untick for an event such as a PTM)
      </label>
      <Button type="submit" disabled={pending} className="justify-self-start">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CalendarPlus className="h-4 w-4" aria-hidden />}
        Add to calendar
      </Button>
    </form>
  );
}
