'use client';

import * as React from 'react';
import { Loader2, Send } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { CLASS_GRADES } from '@/lib/constants';
import { submitAdmissionEnquiry } from '../actions';

interface AdmissionDialogProps {
  schoolSlug: string;
  schoolName: string;
  grades?: readonly string[];
  triggerLabel?: string;
  triggerClassName?: string;
  variant?: 'default' | 'secondary' | 'outline';
  size?: 'default' | 'lg';
  /** Opens on load when the URL hash matches, e.g. /school#apply from the landing page. */
  autoOpenHash?: string;
}

type FieldErrors = Record<string, string[]>;

export function AdmissionDialog({
  schoolSlug,
  schoolName,
  grades = CLASS_GRADES,
  triggerLabel = 'Apply for Admission',
  triggerClassName,
  variant = 'default',
  size = 'lg',
  autoOpenHash,
}: AdmissionDialogProps) {
  const [open, setOpen] = React.useState(false);

  // A hash, not a query string, so the public portal stays statically cached.
  React.useEffect(() => {
    if (autoOpenHash && window.location.hash === `#${autoOpenHash}`) setOpen(true);
  }, [autoOpenHash]);
  const [pending, startTransition] = React.useTransition();
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [targetGrade, setTargetGrade] = React.useState<string>('');
  const formRef = React.useRef<HTMLFormElement>(null);
  const { toast } = useToast();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set('targetGrade', targetGrade);
    setFieldErrors({});

    startTransition(async () => {
      const result = await submitAdmissionEnquiry(schoolSlug, formData);

      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        toast({
          variant: 'destructive',
          title: 'Could not submit your enquiry',
          description: result.error,
        });
        return;
      }

      toast({
        variant: 'success',
        title: 'Enquiry received',
        description: result.data.whatsappDelivered
          ? 'We have sent a confirmation to your WhatsApp. Our admissions team will call you shortly.'
          : 'Our admissions team will call you shortly.',
      });

      formRef.current?.reset();
      setTargetGrade('');
      setOpen(false);
    });
  }

  function errorFor(field: string): string | null {
    return fieldErrors[field]?.[0] ?? null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} className={triggerClassName}>
          {triggerLabel}
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Apply for admission</DialogTitle>
          <DialogDescription>
            Share a few details and the admissions office at {schoolName} will get in touch. You
            will receive a confirmation on WhatsApp.
          </DialogDescription>
        </DialogHeader>

        <form ref={formRef} onSubmit={handleSubmit} className="grid gap-4" noValidate>
          {/* Honeypot: hidden from users and from assistive technology. */}
          <input
            type="text"
            name="company"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="hidden"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="applicantName">Student name</Label>
              <Input
                id="applicantName"
                name="applicantName"
                placeholder="Aarav Sharma"
                autoComplete="name"
                required
                aria-invalid={Boolean(errorFor('applicantName'))}
              />
              {errorFor('applicantName') ? (
                <p className="text-xs text-destructive">{errorFor('applicantName')}</p>
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="parentName">Parent or guardian</Label>
              <Input
                id="parentName"
                name="parentName"
                placeholder="Rakesh Sharma"
                required
                aria-invalid={Boolean(errorFor('parentName'))}
              />
              {errorFor('parentName') ? (
                <p className="text-xs text-destructive">{errorFor('parentName')}</p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="phone">WhatsApp number</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                inputMode="numeric"
                placeholder="98100 12345"
                autoComplete="tel"
                required
                aria-invalid={Boolean(errorFor('phone'))}
              />
              {errorFor('phone') ? (
                <p className="text-xs text-destructive">{errorFor('phone')}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  We will send the acknowledgement here.
                </p>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="targetGrade">Grade applying for</Label>
              <Select value={targetGrade} onValueChange={setTargetGrade} required>
                <SelectTrigger id="targetGrade" aria-invalid={Boolean(errorFor('targetGrade'))}>
                  <SelectValue placeholder="Select a grade" />
                </SelectTrigger>
                <SelectContent>
                  {grades.map((grade) => (
                    <SelectItem key={grade} value={grade}>
                      {grade}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errorFor('targetGrade') ? (
                <p className="text-xs text-destructive">{errorFor('targetGrade')}</p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="email">Email (optional)</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="parent@example.com"
              autoComplete="email"
              aria-invalid={Boolean(errorFor('email'))}
            />
            {errorFor('email') ? (
              <p className="text-xs text-destructive">{errorFor('email')}</p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="message">Anything we should know? (optional)</Label>
            <Textarea
              id="message"
              name="message"
              placeholder="Transferring from another board, transport needed from Pitampura, and so on."
              maxLength={600}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !targetGrade}>
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Submitting
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" aria-hidden />
                  Submit enquiry
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
