'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import type { BloodGroup, Gender } from '@/types/database';
import { Button } from '@/components/ui/button';
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { BLOOD_GROUPS, CLASS_GRADES, SECTIONS } from '@/lib/constants';
import { updateStudent } from '../../actions';

const selectClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

type FieldErrors = Record<string, string[]>;

export interface StudentDetails {
  fullName: string;
  rollNumber: string;
  admissionNumber: string | null;
  classGrade: string;
  section: string;
  parentName: string | null;
  parentPhone: string;
  dateOfBirth: string | null;
  gender: Gender | null;
  bloodGroup: BloodGroup | null;
}

interface EditStudentPanelProps {
  schoolSlug: string;
  studentId: string;
  details: StudentDetails;
  onDone: () => void;
}

export function EditStudentPanel({ schoolSlug, studentId, details, onDone }: EditStudentPanelProps) {
  const [pending, startTransition] = React.useTransition();
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [classGrade, setClassGrade] = React.useState(details.classGrade);
  const { toast } = useToast();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set('studentId', studentId);
    setErrors({});

    startTransition(async () => {
      const result = await updateStudent(schoolSlug, formData);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast({ variant: 'destructive', title: 'Details not saved', description: result.error });
        return;
      }
      toast({
        variant: 'success',
        title: 'Details saved',
        description:
          classGrade !== details.classGrade
            ? `Moved to Class ${classGrade}; dues now follow that class's fee schedule.`
            : undefined,
      });
      onDone();
    });
  }

  function errorFor(field: string) {
    const message = errors[field]?.[0];
    return message ? <p className="text-xs text-destructive">{message}</p> : null;
  }

  const id = (field: string) => `${field}-${studentId}`;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit details</DialogTitle>
        <DialogDescription>
          Correct {details.fullName}&apos;s record. Moving class re-applies that class&apos;s fee
          schedule; payments and any concession are kept.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
        <div className="grid gap-2">
          <Label htmlFor={id('fullName')}>Student name</Label>
          <Input id={id('fullName')} name="fullName" required defaultValue={details.fullName} />
          {errorFor('fullName')}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="grid min-w-0 content-start gap-2">
            <Label htmlFor={id('classGrade')}>Class</Label>
            <select
              id={id('classGrade')}
              name="classGrade"
              className={selectClass}
              value={classGrade}
              onChange={(event) => setClassGrade(event.target.value)}
            >
              {CLASS_GRADES.map((grade) => (
                <option key={grade} value={grade}>
                  {grade}
                </option>
              ))}
            </select>
            {errorFor('classGrade')}
          </div>
          <div className="grid min-w-0 content-start gap-2">
            <Label htmlFor={id('section')}>Section</Label>
            <select
              id={id('section')}
              name="section"
              className={selectClass}
              defaultValue={details.section}
            >
              {SECTIONS.map((section) => (
                <option key={section} value={section}>
                  {section}
                </option>
              ))}
            </select>
          </div>
          <div className="grid min-w-0 content-start gap-2">
            <Label htmlFor={id('rollNumber')}>Roll no.</Label>
            <Input
              id={id('rollNumber')}
              name="rollNumber"
              required
              inputMode="numeric"
              defaultValue={details.rollNumber}
            />
            {errorFor('rollNumber')}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid min-w-0 content-start gap-2">
            <Label htmlFor={id('admissionNumber')}>Admission no.</Label>
            <Input
              id={id('admissionNumber')}
              name="admissionNumber"
              placeholder="Optional"
              defaultValue={details.admissionNumber ?? ''}
            />
          </div>
          <div className="grid min-w-0 content-start gap-2">
            <Label htmlFor={id('dateOfBirth')}>Date of birth</Label>
            <Input
              id={id('dateOfBirth')}
              name="dateOfBirth"
              type="date"
              defaultValue={details.dateOfBirth ?? ''}
            />
            {errorFor('dateOfBirth')}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid min-w-0 content-start gap-2">
            <Label htmlFor={id('gender')}>Gender</Label>
            <select
              id={id('gender')}
              name="gender"
              className={selectClass}
              defaultValue={details.gender ?? ''}
            >
              <option value="">-</option>
              <option value="FEMALE">Female</option>
              <option value="MALE">Male</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div className="grid min-w-0 content-start gap-2">
            <Label htmlFor={id('bloodGroup')}>Blood group</Label>
            <select id={id('bloodGroup')} name="bloodGroup" className={selectClass} defaultValue={details.bloodGroup ?? ''}>
                <option value="">-</option>
                {BLOOD_GROUPS.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid min-w-0 content-start gap-2">
            <Label htmlFor={id('parentName')}>Parent name</Label>
            <Input
              id={id('parentName')}
              name="parentName"
              required
              defaultValue={details.parentName ?? ''}
            />
            {errorFor('parentName')}
          </div>
          <div className="grid min-w-0 content-start gap-2">
            <Label htmlFor={id('parentPhone')}>Parent mobile</Label>
            <Input
              id={id('parentPhone')}
              name="parentPhone"
              type="tel"
              inputMode="tel"
              required
              defaultValue={details.parentPhone}
            />
            {errorFor('parentPhone')}
          </div>
        </div>

        <DialogFooter>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Save details
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
