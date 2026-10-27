'use client';

import * as React from 'react';
import { Loader2, Plus } from 'lucide-react';
import type { StaffRole } from '@/types/database';
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
import { STAFF_ROLE_LABELS } from '@/lib/constants';
import { saveStaff } from '../actions';

const selectClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export interface StaffFormValues {
  id: string;
  fullName: string;
  employeeCode: string;
  staffRole: StaffRole;
  departments: string[];
  email: string | null;
  phone: string | null;
  dateOfJoining: string | null;
  baseSalary: number;
  bankName: string | null;
  bankAccountLast4: string | null;
}

interface StaffDialogProps {
  schoolSlug: string;
  /** Present when editing. */
  staff?: StaffFormValues;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function StaffDialog({ schoolSlug, staff, open, onOpenChange }: StaffDialogProps) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [pending, startTransition] = React.useTransition();
  const { toast } = useToast();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    if (staff) formData.set('staffId', staff.id);
    setErrors({});

    startTransition(async () => {
      const result = await saveStaff(schoolSlug, formData);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast({ variant: 'destructive', title: 'Not saved', description: result.error });
        return;
      }
      toast({
        variant: 'success',
        title: staff ? 'Staff details saved' : `${String(formData.get('fullName'))} added`,
      });
      if (!staff) form.reset();
      setOpen(false);
    });
  }

  const error = (field: string) =>
    errors[field]?.[0] ? <p className="text-xs text-destructive">{errors[field][0]}</p> : null;
  const id = (field: string) => `${field}-${staff?.id ?? 'new'}`;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setErrors({});
      }}
    >
      {staff ? null : (
        <DialogTrigger asChild>
          <Button>
            <Plus className="h-4 w-4" aria-hidden />
            Add staff
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{staff ? `Edit ${staff.fullName}` : 'Add a staff member'}</DialogTitle>
          <DialogDescription>
            The role and departments describe the job; they do not create a login or grant access.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor={id('fullName')}>Full name</Label>
              <Input id={id('fullName')} name="fullName" defaultValue={staff?.fullName} required />
              {error('fullName')}
            </div>
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor={id('employeeCode')}>Employee code</Label>
              <Input
                id={id('employeeCode')}
                name="employeeCode"
                defaultValue={staff?.employeeCode}
                autoCapitalize="characters"
                placeholder="EMP-014"
                required
              />
              {error('employeeCode')}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor={id('staffRole')}>Role</Label>
              <select
                id={id('staffRole')}
                name="staffRole"
                className={selectClass}
                defaultValue={staff?.staffRole ?? ''}
                required
              >
                <option value="" disabled>
                  Select
                </option>
                {Object.entries(STAFF_ROLE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {error('staffRole')}
            </div>
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor={id('baseSalary')}>Monthly base salary (₹)</Label>
              <Input
                id={id('baseSalary')}
                name="baseSalary"
                type="number"
                min={0}
                step="1"
                inputMode="numeric"
                defaultValue={staff?.baseSalary}
                required
              />
              {error('baseSalary')}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor={id('departments')}>Departments</Label>
            <Input
              id={id('departments')}
              name="departments"
              defaultValue={staff?.departments.join(', ')}
              placeholder="Science, Examinations"
            />
            <p className="text-xs text-muted-foreground">Separate with commas.</p>
            {error('departments')}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor={id('email')}>Email</Label>
              <Input id={id('email')} name="email" type="email" defaultValue={staff?.email ?? ''} />
              {error('email')}
            </div>
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor={id('phone')}>Mobile</Label>
              <Input
                id={id('phone')}
                name="phone"
                type="tel"
                inputMode="tel"
                defaultValue={staff?.phone ?? ''}
              />
              {error('phone')}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor={id('dateOfJoining')}>Date of joining</Label>
              <Input
                id={id('dateOfJoining')}
                name="dateOfJoining"
                type="date"
                defaultValue={staff?.dateOfJoining ?? ''}
              />
              {error('dateOfJoining')}
            </div>
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor={id('bankName')}>Bank</Label>
              <Input id={id('bankName')} name="bankName" defaultValue={staff?.bankName ?? ''} />
            </div>
            <div className="grid min-w-0 content-start gap-2">
              <Label htmlFor={id('bankAccountLast4')}>Account, last 4</Label>
              <Input
                id={id('bankAccountLast4')}
                name="bankAccountLast4"
                inputMode="numeric"
                maxLength={4}
                defaultValue={staff?.bankAccountLast4 ?? ''}
              />
              {error('bankAccountLast4')}
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {staff ? 'Save changes' : 'Add staff member'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
