'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, LogOut, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { completeFirstLogin } from './actions';

interface FirstLoginDialogProps {
  open: boolean;
  next: string | null;
  defaultPhone?: string | null;
}

type FieldErrors = Record<string, string[]>;

/**
 * Mandatory first-login step. It cannot be dismissed: no close button, and
 * Escape or an outside click do nothing. The only other way out is signing
 * out.
 */
export function FirstLoginDialog({ open, next, defaultPhone }: FirstLoginDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    if (next) formData.set('next', next);
    setErrors({});
    setFormError(null);

    startTransition(async () => {
      const result = await completeFirstLogin(formData);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.error);
        return;
      }
      router.replace(result.data.redirectTo);
      router.refresh();
    });
  }

  function errorFor(field: string) {
    const message = errors[field]?.[0];
    return message ? <p className="text-xs text-destructive">{message}</p> : null;
  }

  return (
    <Dialog open={open}>
      <DialogContent
        hideClose
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        className="sm:max-w-[440px]"
      >
        <DialogHeader>
          <span className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </span>
          <DialogTitle>Update Password &amp; Security Information</DialogTitle>
          <DialogDescription>
            You signed in with a temporary password from your school. Choose your own password to
            continue. It must be at least 10 characters and include a letter and a number.
          </DialogDescription>
        </DialogHeader>

        <form id="first-login-form" onSubmit={handleSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              autoFocus
            />
            {errorFor('password')}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
            />
            {errorFor('confirm')}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="recovery-phone">Mobile number for school alerts</Label>
            <Input
              id="recovery-phone"
              name="phone"
              type="tel"
              inputMode="tel"
              placeholder="98100 12345"
              defaultValue={defaultPhone ?? ''}
            />
            {errorFor('phone')}
          </div>

          {formError && Object.keys(errors).length === 0 ? (
            <p className="text-sm text-destructive">{formError}</p>
          ) : null}
        </form>

        <DialogFooter className="gap-2 sm:justify-between">
          <form action="/auth/sign-out" method="post">
            <Button type="submit" variant="ghost" className="w-full sm:w-auto">
              <LogOut className="h-4 w-4" aria-hidden />
              Sign out
            </Button>
          </form>
          <Button type="submit" form="first-login-form" disabled={pending}>
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <KeyRound className="h-4 w-4" aria-hidden />
            )}
            Save and continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
