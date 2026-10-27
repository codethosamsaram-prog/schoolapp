'use client';

import * as React from 'react';
import {
  BadgePercent,
  Camera,
  GraduationCap,
  IndianRupee,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Pencil,
  UserCheck,
  UserMinus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { formatINR, todayInIST } from '@/lib/utils';
import {
  provisionParentAccount,
  recordOfflinePayment,
  setFeeConcession,
  setStudentActive,
} from '../../actions';
import { EditStudentPanel, type StudentDetails } from './edit-student-panel';
import { StudentLoginPanel, StudentPhotoPanel } from './student-identity-panels';

const selectClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

type FieldErrors = Record<string, string[]>;
type Panel = 'details' | 'parent' | 'student-login' | 'photo' | 'payment' | 'concession' | null;

interface StudentActionsProps {
  schoolSlug: string;
  schoolId: string;
  usn: string | null;
  hasStudentLogin: boolean;
  avatarSrc: string | null;
  studentId: string;
  studentName: string;
  isActive: boolean;
  hasParentLogin: boolean;
  balance: number;
  concession: number;
  concessionNote: string | null;
  details: StudentDetails;
}

export function StudentActions(props: StudentActionsProps) {
  const { schoolSlug, studentId, studentName, isActive, hasParentLogin, balance } = props;
  const [panel, setPanel] = React.useState<Panel>(null);
  const [pending, startTransition] = React.useTransition();
  const { toast } = useToast();

  function toggleActive() {
    startTransition(async () => {
      const result = await setStudentActive(schoolSlug, studentId, !isActive);
      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Update failed', description: result.error });
        return;
      }
      toast({
        title: result.data.isActive ? `${studentName} re-admitted` : `${studentName} withdrawn`,
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
            aria-label={`Actions for ${studentName}`}
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setPanel('details')}>
            <Pencil className="mr-2 h-4 w-4" aria-hidden />
            Edit details
          </DropdownMenuItem>
          <DropdownMenuItem disabled={balance <= 0} onSelect={() => setPanel('payment')}>
            <IndianRupee className="mr-2 h-4 w-4" aria-hidden />
            Record payment
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPanel('concession')}>
            <BadgePercent className="mr-2 h-4 w-4" aria-hidden />
            Fee concession
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPanel('parent')}>
            <KeyRound className="mr-2 h-4 w-4" aria-hidden />
            {hasParentLogin ? 'Change parent login' : 'Create parent login'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPanel('student-login')}>
            <GraduationCap className="mr-2 h-4 w-4" aria-hidden />
            {props.hasStudentLogin ? 'Reset student login' : 'Create student login'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPanel('photo')}>
            <Camera className="mr-2 h-4 w-4" aria-hidden />
            {props.avatarSrc ? 'Change photo' : 'Add photo'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={toggleActive}>
            {isActive ? (
              <UserMinus className="mr-2 h-4 w-4" aria-hidden />
            ) : (
              <UserCheck className="mr-2 h-4 w-4" aria-hidden />
            )}
            {isActive ? 'Withdraw student' : 'Re-admit student'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={panel !== null} onOpenChange={(open) => !open && setPanel(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto text-left sm:max-w-[460px]">
          {panel === 'details' ? (
            <EditStudentPanel {...props} onDone={() => setPanel(null)} />
          ) : panel === 'payment' ? (
            <PaymentPanel {...props} onDone={() => setPanel(null)} />
          ) : panel === 'concession' ? (
            <ConcessionPanel {...props} onDone={() => setPanel(null)} />
          ) : panel === 'parent' ? (
            <ParentLoginPanel {...props} onDone={() => setPanel(null)} />
          ) : panel === 'student-login' ? (
            <StudentLoginPanel {...props} onDone={() => setPanel(null)} />
          ) : panel === 'photo' ? (
            <StudentPhotoPanel {...props} onDone={() => setPanel(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

type PanelProps = StudentActionsProps & { onDone: () => void };

function FieldError({ errors, field }: { errors: FieldErrors; field: string }) {
  const message = errors[field]?.[0];
  return message ? <p className="text-xs text-destructive">{message}</p> : null;
}

function PaymentPanel({ schoolSlug, studentId, studentName, balance, onDone }: PanelProps) {
  const [pending, startTransition] = React.useTransition();
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [method, setMethod] = React.useState('CASH');
  const { toast } = useToast();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set('studentId', studentId);
    setErrors({});

    startTransition(async () => {
      const result = await recordOfflinePayment(schoolSlug, formData);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast({ variant: 'destructive', title: 'Payment not recorded', description: result.error });
        return;
      }
      toast({
        variant: 'success',
        title: `Receipt ${result.data.receiptNumber} issued`,
        description: result.data.whatsappDelivered
          ? 'The parent has been sent the receipt on WhatsApp.'
          : 'Open it from the payments list on the Fees page.',
      });
      onDone();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Record a payment</DialogTitle>
        <DialogDescription>
          Fees collected at the office for {studentName}. {formatINR(balance)} is outstanding.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
        <div className="grid grid-cols-2 gap-4">
          <div className="grid min-w-0 content-start gap-2">
            <Label htmlFor={`amount-${studentId}`}>Amount (₹)</Label>
            <Input
              id={`amount-${studentId}`}
              name="amount"
              type="number"
              min={1}
              max={balance}
              step="0.01"
              inputMode="decimal"
              defaultValue={balance}
              required
            />
            <FieldError errors={errors} field="amount" />
          </div>
          <div className="grid min-w-0 content-start gap-2">
            <Label htmlFor={`paidOn-${studentId}`}>Received on</Label>
            <Input
              id={`paidOn-${studentId}`}
              name="paidOn"
              type="date"
              max={todayInIST()}
              defaultValue={todayInIST()}
              required
            />
            <FieldError errors={errors} field="paidOn" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid min-w-0 content-start gap-2">
            <Label htmlFor={`method-${studentId}`}>Mode</Label>
            <select
              id={`method-${studentId}`}
              name="method"
              className={selectClass}
              value={method}
              onChange={(event) => setMethod(event.target.value)}
            >
              <option value="CASH">Cash</option>
              <option value="CHEQUE">Cheque</option>
              <option value="DD">Demand draft</option>
              <option value="BANK_TRANSFER">Bank transfer</option>
            </select>
          </div>
          <div className="grid min-w-0 content-start gap-2">
            <Label htmlFor={`reference-${studentId}`}>
              {method === 'BANK_TRANSFER' ? 'UTR / reference' : 'Number'}
            </Label>
            <Input
              id={`reference-${studentId}`}
              name="reference"
              disabled={method === 'CASH'}
              placeholder={method === 'CASH' ? 'Not needed' : ''}
              required={method !== 'CASH'}
            />
            <FieldError errors={errors} field="reference" />
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor={`notes-${studentId}`}>Printed on receipt as</Label>
          <Input id={`notes-${studentId}`} name="notes" placeholder="Fee payment" maxLength={200} />
        </div>

        <DialogFooter>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Record and issue receipt
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function ConcessionPanel({
  schoolSlug,
  studentId,
  studentName,
  concession,
  concessionNote,
  onDone,
}: PanelProps) {
  const [pending, startTransition] = React.useTransition();
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const { toast } = useToast();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set('studentId', studentId);
    setErrors({});

    startTransition(async () => {
      const result = await setFeeConcession(schoolSlug, formData);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast({ variant: 'destructive', title: 'Concession not saved', description: result.error });
        return;
      }
      toast({
        variant: 'success',
        title: 'Concession saved',
        description: `${studentName} now owes ${formatINR(result.data.totalFeeDue)} for the year, ${formatINR(result.data.balance)} outstanding.`,
      });
      onDone();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Fee concession</DialogTitle>
        <DialogDescription>
          A reduction on {studentName}&apos;s annual dues. It stays in place when the class fee
          schedule changes. Set it to 0 to remove it.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
        <div className="grid gap-2">
          <Label htmlFor={`concession-${studentId}`}>Concession for the year (₹)</Label>
          <Input
            id={`concession-${studentId}`}
            name="amount"
            type="number"
            min={0}
            step="1"
            inputMode="numeric"
            defaultValue={concession}
            required
          />
          <FieldError errors={errors} field="amount" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`concession-note-${studentId}`}>Reason</Label>
          <Input
            id={`concession-note-${studentId}`}
            name="note"
            placeholder="Merit scholarship, sibling discount..."
            defaultValue={concessionNote ?? ''}
            maxLength={200}
          />
        </div>
        <DialogFooter>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Save concession
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function ParentLoginPanel({ schoolSlug, studentId, studentName, onDone }: PanelProps) {
  const [pending, startTransition] = React.useTransition();
  const [emailError, setEmailError] = React.useState<string | null>(null);
  const [issued, setIssued] = React.useState<{ email: string; password: string | null } | null>(
    null,
  );

  function handleProvision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set('studentId', studentId);
    setEmailError(null);

    startTransition(async () => {
      const result = await provisionParentAccount(schoolSlug, formData);
      if (!result.ok) {
        setEmailError(result.fieldErrors?.email?.[0] ?? result.error);
        return;
      }
      setIssued({ email: result.data.email, password: result.data.temporaryPassword });
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Parent portal login</DialogTitle>
        <DialogDescription>
          The parent of {studentName} can then see fees, receipts and attendance, and pay online.
          Siblings can share one login: enter the same email for each child.
        </DialogDescription>
      </DialogHeader>

      {issued ? (
        <div className="space-y-3 text-sm">
          {issued.password ? (
            <>
              <p>
                Login created. Share these details with the parent. The password is shown only once.
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border bg-muted/40 p-3 font-mono text-xs">
                <dt className="text-muted-foreground">Email</dt>
                <dd className="break-all">{issued.email}</dd>
                <dt className="text-muted-foreground">Password</dt>
                <dd className="select-all break-all">{issued.password}</dd>
              </dl>
            </>
          ) : (
            <p>
              {studentName} is now linked to the existing parent login{' '}
              <span className="font-medium">{issued.email}</span>.
            </p>
          )}
          <DialogFooter>
            <Button onClick={onDone}>Done</Button>
          </DialogFooter>
        </div>
      ) : (
        <form onSubmit={handleProvision} className="grid gap-4" noValidate>
          <div className="grid gap-2">
            <Label htmlFor={`parent-email-${studentId}`}>Parent email</Label>
            <Input
              id={`parent-email-${studentId}`}
              name="email"
              type="email"
              autoComplete="off"
              required
            />
            {emailError ? <p className="text-xs text-destructive">{emailError}</p> : null}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Create or link login
            </Button>
          </DialogFooter>
        </form>
      )}
    </>
  );
}
