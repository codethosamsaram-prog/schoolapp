'use client';

import * as React from 'react';
import { FileText, IndianRupee, Loader2, MoreHorizontal, Pencil, UserCheck, UserMinus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/use-toast';
import { setStaffActive } from '../actions';
import { ProcessSalaryDialog } from './process-salary-dialog';
import { StaffDialog, type StaffFormValues } from './staff-dialog';

interface StaffRowActionsProps {
  schoolSlug: string;
  staff: StaffFormValues & { isActive: boolean };
  month: string;
  monthLabel: string;
  payslipId: string | null;
}

export function StaffRowActions({ schoolSlug, staff, month, monthLabel, payslipId }: StaffRowActionsProps) {
  const [panel, setPanel] = React.useState<'pay' | 'edit' | null>(null);
  const [pending, startTransition] = React.useTransition();
  const { toast } = useToast();

  function toggleActive() {
    startTransition(async () => {
      const result = await setStaffActive(schoolSlug, staff.id, !staff.isActive);
      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Update failed', description: result.error });
        return;
      }
      toast({
        title: result.data.isActive
          ? `${staff.fullName} is back on the payroll`
          : `${staff.fullName} taken off the payroll`,
      });
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            disabled={pending}
            aria-label={`Actions for ${staff.fullName}`}
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {payslipId ? (
            <DropdownMenuItem asChild>
              <a href={`/payslips/${payslipId}`} target="_blank" rel="noreferrer">
                <FileText className="mr-2 h-4 w-4" aria-hidden />
                Open payslip
              </a>
            </DropdownMenuItem>
          ) : staff.isActive ? (
            <DropdownMenuItem onSelect={() => setPanel('pay')}>
              <IndianRupee className="mr-2 h-4 w-4" aria-hidden />
              Process salary
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => setPanel('edit')}>
            <Pencil className="mr-2 h-4 w-4" aria-hidden />
            Edit details
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={toggleActive}>
            {staff.isActive ? (
              <UserMinus className="mr-2 h-4 w-4" aria-hidden />
            ) : (
              <UserCheck className="mr-2 h-4 w-4" aria-hidden />
            )}
            {staff.isActive ? 'Take off payroll' : 'Put back on payroll'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ProcessSalaryDialog
        open={panel === 'pay'}
        onOpenChange={(open) => setPanel(open ? 'pay' : null)}
        month={month}
        monthLabel={monthLabel}
        staff={staff}
      />
      <StaffDialog
        schoolSlug={schoolSlug}
        staff={staff}
        open={panel === 'edit'}
        onOpenChange={(open) => setPanel(open ? 'edit' : null)}
      />
    </>
  );
}
