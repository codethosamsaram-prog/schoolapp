'use client';

import * as React from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { BLOOD_GROUPS, CLASS_GRADES, SECTIONS } from '@/lib/constants';
import { createStudent } from '../../actions';

const selectClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

type FieldErrors = Record<string, string[]>;

export interface StudentDefaults {
  fullName?: string;
  classGrade?: string;
  parentName?: string;
  parentPhone?: string;
}

interface AddStudentDialogProps {
  schoolSlug: string;
  /** Pre-fills the form; used when enrolling an admitted enquiry. */
  defaults?: StudentDefaults;
  /** The admission lead this enrolment converts, if any. */
  leadId?: string;
  trigger?: React.ReactNode;
}

export function AddStudentDialog({ schoolSlug, defaults, leadId, trigger }: AddStudentDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const { toast } = useToast();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    if (leadId) formData.set('leadId', leadId);
    setFieldErrors({});

    startTransition(async () => {
      const result = await createStudent(schoolSlug, formData);

      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        toast({ variant: 'destructive', title: 'Could not enrol student', description: result.error });
        return;
      }

      toast({
        variant: 'success',
        title: `${String(formData.get('fullName'))} enrolled`,
        description: 'Fee dues were set from the class fee schedule.',
      });
      form.reset();
      setOpen(false);
    });
  }

  function errorFor(field: string) {
    const message = fieldErrors[field]?.[0];
    return message ? <p className="text-xs text-destructive">{message}</p> : null;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setFieldErrors({});
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="h-4 w-4" aria-hidden />
            Add student
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Enrol a student</DialogTitle>
          <DialogDescription>
            The parent&apos;s mobile number receives attendance and fee alerts on WhatsApp.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-2">
            <Label htmlFor="fullName">Student name</Label>
            <Input
              id="fullName"
              name="fullName"
              required
              autoComplete="off"
              defaultValue={defaults?.fullName}
            />
            {errorFor('fullName')}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor="classGrade">Class</Label>
              <select
                id="classGrade"
                name="classGrade"
                required
                className={selectClass}
                defaultValue={
                  (CLASS_GRADES as readonly string[]).includes(defaults?.classGrade ?? '')
                    ? defaults?.classGrade
                    : ''
                }
              >
                <option value="" disabled>
                  Select
                </option>
                {CLASS_GRADES.map((grade) => (
                  <option key={grade} value={grade}>
                    {grade}
                  </option>
                ))}
              </select>
              {errorFor('classGrade')}
            </div>
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor="section">Section</Label>
              <select id="section" name="section" required className={selectClass} defaultValue="A">
                {SECTIONS.map((section) => (
                  <option key={section} value={section}>
                    {section}
                  </option>
                ))}
              </select>
              {errorFor('section')}
            </div>
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor="rollNumber">Roll no.</Label>
              <Input id="rollNumber" name="rollNumber" required inputMode="numeric" />
              {errorFor('rollNumber')}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor="usn">USN</Label>
              <Input id="usn" name="usn" placeholder="Optional" autoCapitalize="characters" />
              {errorFor('usn')}
            </div>
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor="admissionNumber">Admission no.</Label>
              <Input id="admissionNumber" name="admissionNumber" placeholder="Optional" />
              {errorFor('admissionNumber')}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor="dateOfBirth">Date of birth</Label>
              <Input id="dateOfBirth" name="dateOfBirth" type="date" />
              {errorFor('dateOfBirth')}
            </div>
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor="gender">Gender</Label>
              <select id="gender" name="gender" className={selectClass} defaultValue="">
                <option value="">-</option>
                <option value="FEMALE">Female</option>
                <option value="MALE">Male</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor="bloodGroup">Blood group</Label>
              <select id="bloodGroup" name="bloodGroup" className={selectClass} defaultValue="">
                <option value="">-</option>
                {BLOOD_GROUPS.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor="parentName">Parent name</Label>
              <Input
                id="parentName"
                name="parentName"
                required
                defaultValue={defaults?.parentName}
              />
              {errorFor('parentName')}
            </div>
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor="parentPhone">Parent mobile</Label>
              <Input
                id="parentPhone"
                name="parentPhone"
                type="tel"
                inputMode="tel"
                placeholder="98100 12345"
                required
                defaultValue={defaults?.parentPhone}
              />
              {errorFor('parentPhone')}
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Enrol student
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
