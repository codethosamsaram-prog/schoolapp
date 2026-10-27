'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SchoolCombobox, type SchoolOption } from '@/components/school-combobox';
import { createClient } from '@/lib/supabase/client';
import { USN_PATTERN, homeRouteForRole, studentLoginEmail } from '@/lib/auth-routes';
import { cn } from '@/lib/utils';
import { FirstLoginDialog } from './first-login-dialog';

export type LoginRole = 'student' | 'staff';

interface LoginFormProps {
  schools: SchoolOption[];
  role: LoginRole;
  initialSchool: SchoolOption | null;
  next: string | null;
  /** Already signed in with a temporary password: open the mandatory step. */
  pendingSetup: { phone: string | null } | null;
}

/**
 * Sign-in: school, then ID/USN/email, then password.
 *
 * Students type their USN, which maps to the account's internal login email
 * for that school. Parents and staff use their email. After sign-in the
 * account must belong to the chosen school. A school-issued temporary password
 * opens the mandatory first-login dialog before anything else loads.
 */
export function LoginForm({ schools, role, initialSchool, next, pendingSetup }: LoginFormProps) {
  const router = useRouter();
  const [school, setSchool] = React.useState<SchoolOption | null>(initialSchool);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showPassword, setShowPassword] = React.useState(false);
  const [setup, setSetup] = React.useState(pendingSetup);

  const isStudent = role === 'student';

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!school) {
      setError('Choose your school first.');
      return;
    }

    const formData = new FormData(event.currentTarget);
    const identifier = String(formData.get('identifier') ?? '').trim();
    const password = String(formData.get('password') ?? '');

    let email: string;
    if (identifier.includes('@')) {
      email = identifier.toLowerCase();
    } else if (USN_PATTERN.test(identifier)) {
      email = studentLoginEmail(school.slug, identifier);
    } else {
      setError(isStudent ? 'Enter your USN, or a parent email address.' : 'Enter your staff email address.');
      return;
    }

    setPending(true);
    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError || !data.user) {
      setPending(false);
      setError(
        signInError?.message === 'Invalid login credentials'
          ? 'That ID and password do not match an account at this school.'
          : signInError?.message ?? 'Could not sign you in. Please try again.',
      );
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, school_id, phone, must_change_password')
      .eq('id', data.user.id)
      .maybeSingle();

    if (!profile || (profile.role !== 'SUPER_ADMIN' && profile.school_id !== school.id)) {
      await supabase.auth.signOut();
      setPending(false);
      setError(`This account is not registered at ${school.name}.`);
      return;
    }

    if (profile.must_change_password) {
      setPending(false);
      setSetup({ phone: profile.phone });
      return;
    }

    if (next && next.startsWith('/') && !next.startsWith('//')) {
      router.replace(next);
    } else {
      router.replace(homeRouteForRole(school.slug, profile.role));
    }
    router.refresh();
  }

  return (
    <>
      <div
        role="tablist"
        aria-label="Sign in as"
        className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm font-medium"
      >
        {(['student', 'staff'] as const).map((option) => (
          <Link
            key={option}
            role="tab"
            aria-selected={role === option}
            replace
            href={`/login?role=${option}${school ? `&school=${school.slug}` : ''}${next ? `&next=${encodeURIComponent(next)}` : ''}`}
            className={cn(
              'rounded-md px-3 py-1.5 text-center transition-colors',
              role === option ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option === 'student' ? 'Student / Parent' : 'Staff'}
          </Link>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
        <div className="grid gap-2">
          <Label htmlFor="school">School</Label>
          <SchoolCombobox id="school" schools={schools} value={school} onChange={setSchool} />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="identifier">{isStudent ? 'ID / USN or parent email' : 'Staff email'}</Label>
          <Input
            id="identifier"
            name="identifier"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={isStudent ? 'DPS20200141 or parent@example.com' : 'you@school.edu.in'}
            required
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              minLength={8}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={pending}>
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Signing in
            </>
          ) : (
            'Sign in'
          )}
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          {isStudent
            ? 'Your USN and first password come from the school office.'
            : 'Staff accounts are created by your school administrator.'}
        </p>
      </form>

      <FirstLoginDialog open={setup !== null} next={next} defaultPhone={setup?.phone} />
    </>
  );
}
