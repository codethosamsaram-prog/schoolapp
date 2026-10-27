'use client';

import * as React from 'react';
import { CheckCircle2, ChevronDown, GraduationCap, Loader2, Phone } from 'lucide-react';
import type { AdmissionLead, LeadStatus } from '@/types/database';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import { LEAD_STATUSES, LEAD_STATUS_LABELS, LEAD_STATUS_STYLES } from '@/lib/constants';
import { cn, formatDateTime } from '@/lib/utils';
import { updateLeadStatus } from '../../actions';
import { AddStudentDialog } from '../../students/_components/add-student-dialog';

interface LeadsTableProps {
  schoolSlug: string;
  leads: AdmissionLead[];
}

export function LeadsTable({ schoolSlug, leads }: LeadsTableProps) {
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();
  const { toast } = useToast();

  // Optimistic overlay: the row reflects the new status while the action runs,
  // and reverts if the server rejects it.
  const [overrides, setOverrides] = React.useState<Record<string, LeadStatus>>({});

  function handleChange(lead: AdmissionLead, status: LeadStatus) {
    if (lead.status === status) return;

    setPendingId(lead.id);
    setOverrides((current) => ({ ...current, [lead.id]: status }));

    startTransition(async () => {
      const result = await updateLeadStatus(schoolSlug, lead.id, status);
      setPendingId(null);

      if (!result.ok) {
        setOverrides((current) => {
          const next = { ...current };
          delete next[lead.id];
          return next;
        });
        toast({ variant: 'destructive', title: 'Update failed', description: result.error });
        return;
      }

      toast({
        title: `${lead.applicant_name} marked ${LEAD_STATUS_LABELS[status]}`,
        description: 'The admissions pipeline has been updated.',
      });
    });
  }

  if (leads.length === 0) {
    return (
      <div className="px-6 py-12 text-center text-sm text-muted-foreground">
        No admission enquiries yet. They appear here the moment a parent submits the form on your
        public portal.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Applicant</TableHead>
          <TableHead className="hidden sm:table-cell">Parent</TableHead>
          <TableHead className="hidden md:table-cell">Grade</TableHead>
          <TableHead className="hidden lg:table-cell">Received</TableHead>
          <TableHead className="text-right">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {leads.map((lead) => {
          const status = overrides[lead.id] ?? lead.status;
          const isPending = pendingId === lead.id;

          return (
            <TableRow key={lead.id}>
              <TableCell>
                <div className="font-medium">{lead.applicant_name}</div>
                {lead.message ? (
                  <p className="mt-0.5 line-clamp-2 max-w-xs text-xs text-muted-foreground">
                    {lead.message}
                  </p>
                ) : null}
                <a
                  href={`tel:+91${lead.phone}`}
                  className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground sm:hidden"
                >
                  <Phone className="h-3 w-3" aria-hidden />
                  {lead.phone}
                </a>
              </TableCell>

              <TableCell className="hidden sm:table-cell">
                <div className="text-sm">{lead.parent_name}</div>
                <a
                  href={`tel:+91${lead.phone}`}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {lead.phone}
                </a>
              </TableCell>

              <TableCell className="hidden md:table-cell">
                <Badge variant="outline">{lead.target_grade}</Badge>
              </TableCell>

              <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground lg:table-cell">
                {formatDateTime(lead.created_at)}
              </TableCell>

              <TableCell className="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1 px-2"
                      disabled={isPending}
                      aria-label={`Change status for ${lead.applicant_name}`}
                    >
                      {isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : null}
                      <span
                        className={cn(
                          'rounded-full border px-2 py-0.5 text-xs font-semibold',
                          LEAD_STATUS_STYLES[status],
                        )}
                      >
                        {LEAD_STATUS_LABELS[status]}
                      </span>
                      <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Move to</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {LEAD_STATUSES.map((option) => (
                      <DropdownMenuItem
                        key={option}
                        disabled={option === status}
                        onSelect={() => handleChange(lead, option)}
                      >
                        {LEAD_STATUS_LABELS[option]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                {lead.student_id ? (
                  <div className="mt-1 flex items-center justify-end gap-1 text-xs text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                    Enrolled
                  </div>
                ) : status === 'ADMITTED' && !isPending ? (
                  <div className="mt-1">
                    <AddStudentDialog
                      schoolSlug={schoolSlug}
                      leadId={lead.id}
                      defaults={{
                        fullName: lead.applicant_name,
                        classGrade: lead.target_grade,
                        parentName: lead.parent_name,
                        parentPhone: lead.phone,
                      }}
                      trigger={
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs"
                          aria-label={`Enrol ${lead.applicant_name} as a student`}
                        >
                          <GraduationCap className="h-3.5 w-3.5" aria-hidden />
                          Enrol
                        </Button>
                      }
                    />
                  </div>
                ) : null}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
