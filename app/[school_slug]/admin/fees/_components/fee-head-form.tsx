'use client';

import * as React from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { useToast } from '@/components/ui/use-toast';
import { CLASS_GRADES } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { createFeeType, deleteFeeType, upsertFeeStructure } from '../../actions';

type FieldErrors = Record<string, string[]>;

export interface FeeTypeOption {
  id: string;
  name: string;
  isSystem: boolean;
}

export interface FeeStudentOption {
  id: string;
  label: string;
  classGrade: string;
}

interface FeeHeadFormProps {
  schoolSlug: string;
  feeTypes: FeeTypeOption[];
  students: FeeStudentOption[];
}

/**
 * Adds or updates a fee head, in a category, for a whole class or for one
 * student in it (a bus route, a re-exam, a lost-ID-card charge).
 */
export function FeeHeadForm({ schoolSlug, feeTypes, students }: FeeHeadFormProps) {
  const [pending, startTransition] = React.useTransition();
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [grade, setGrade] = React.useState('');
  const [scope, setScope] = React.useState<'class' | 'student'>('class');
  const { toast } = useToast();

  const classStudents = students.filter((student) => student.classGrade === grade);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    if (scope === 'class') formData.delete('studentId');
    setFieldErrors({});

    startTransition(async () => {
      const result = await upsertFeeStructure(schoolSlug, formData);
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        toast({ variant: 'destructive', title: 'Could not save fee head', description: result.error });
        return;
      }
      toast({
        variant: 'success',
        title: 'Fee head saved',
        description:
          scope === 'student'
            ? 'Charged to the selected student.'
            : `Class ${String(formData.get('classGrade'))} dues have been updated.`,
      });
      form.reset();
      setGrade('');
      setScope('class');
    });
  }

  function errorFor(field: string) {
    const message = fieldErrors[field]?.[0];
    return message ? <p className="text-xs text-destructive">{message}</p> : null;
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
      <div className="grid gap-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" placeholder="Tuition Fee - Term I" required />
        {errorFor('title')}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid min-w-0 content-start gap-2">
          <Label htmlFor="feeTypeId">Category</Label>
          <NativeSelect id="feeTypeId" name="feeTypeId" defaultValue="">
            <option value="">Custom</option>
            {feeTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid min-w-0 content-start gap-2">
          <Label htmlFor="amount">Amount (₹)</Label>
          <Input id="amount" name="amount" type="number" min={0} step="1" inputMode="numeric" required />
          {errorFor('amount')}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid min-w-0 content-start gap-2">
          <Label htmlFor="classGrade">Class</Label>
          <NativeSelect
            id="classGrade"
            name="classGrade"
            required
            value={grade}
            onChange={(event) => setGrade(event.target.value)}
          >
            <option value="" disabled>
              Select
            </option>
            {CLASS_GRADES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </NativeSelect>
          {errorFor('classGrade')}
        </div>
        <div className="grid min-w-0 content-start gap-2">
          <Label htmlFor="dueDate">Due date</Label>
          <Input id="dueDate" name="dueDate" type="date" required />
          {errorFor('dueDate')}
        </div>
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Charge to</legend>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm font-medium">
          {(
            [
              ['class', 'Whole class'],
              ['student', 'One student'],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={cn(
                'cursor-pointer rounded-md px-2 py-1.5 text-center',
                scope === value ? 'bg-background shadow-sm' : 'text-muted-foreground',
              )}
            >
              <input
                type="radio"
                name="scope"
                value={value}
                checked={scope === value}
                onChange={() => setScope(value)}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
        {scope === 'student' ? (
          <NativeSelect name="studentId" aria-label="Student" required disabled={!grade}>
            {!grade ? <option value="">Pick a class first</option> : null}
            {grade && classStudents.length === 0 ? <option value="">No students in Class {grade}</option> : null}
            {classStudents.map((student) => (
              <option key={student.id} value={student.id}>
                {student.label}
              </option>
            ))}
          </NativeSelect>
        ) : null}
      </fieldset>

      <div className="grid gap-2">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" rows={2} placeholder="Optional" />
        {errorFor('description')}
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        Save fee head
      </Button>
    </form>
  );
}

/** Lists the fee categories and adds custom ones. */
export function FeeTypeManager({ schoolSlug, feeTypes }: { schoolSlug: string; feeTypes: FeeTypeOption[] }) {
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const { toast } = useToast();

  function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setError(null);
    startTransition(async () => {
      const result = await createFeeType(schoolSlug, formData);
      if (!result.ok) {
        setError(result.fieldErrors?.name?.[0] ?? result.error);
        return;
      }
      toast({ variant: 'success', title: `${result.data.name} added` });
      form.reset();
    });
  }

  function remove(id: string, name: string) {
    startTransition(async () => {
      const result = await deleteFeeType(schoolSlug, id);
      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Not removed', description: result.error });
        return;
      }
      toast({ title: `${name} removed` });
    });
  }

  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-2">
        {feeTypes.map((type) => (
          <li
            key={type.id}
            className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-1 pl-3 pr-1.5 text-sm"
          >
            {type.name}
            {type.isSystem ? (
              <span className="px-1 text-[10px] uppercase text-muted-foreground">standard</span>
            ) : (
              <button
                type="button"
                onClick={() => remove(type.id, type.name)}
                disabled={pending}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={`Remove ${type.name}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex gap-2">
        <Input name="name" placeholder="New category, e.g. Sports" aria-label="New fee category" maxLength={40} />
        <Button type="submit" variant="secondary" disabled={pending}>
          <Plus className="h-4 w-4" aria-hidden />
          Add
        </Button>
      </form>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
