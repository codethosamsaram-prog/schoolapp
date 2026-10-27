import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, GraduationCap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getCurrentProfile } from '@/lib/auth';
import { listActiveSchools } from '@/lib/schools';
import { LoginForm, type LoginRole } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

interface LoginPageProps {
  searchParams: { role?: string; school?: string; next?: string };
}

/** The school slug a deep link points into, e.g. /demo-public-school/portal. */
function slugFromNext(next: string | undefined): string | null {
  const match = next?.match(/^\/([a-z0-9-]+)(?:\/|$)/);
  return match && match[1] !== 'login' ? match[1] : null;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [schools, current] = await Promise.all([listActiveSchools(), getCurrentProfile()]);

  const next = searchParams.next ?? null;
  const role: LoginRole = searchParams.role === 'staff' ? 'staff' : 'student';
  const slug = searchParams.school ?? slugFromNext(searchParams.next);
  const signedInSchool = current?.profile.school_id
    ? schools.find((school) => school.id === current.profile.school_id) ?? null
    : null;
  const initialSchool = signedInSchool ?? schools.find((school) => school.slug === slug) ?? null;

  // Signed in but still on a temporary password: every tenant route sends the
  // user here, and the mandatory dialog opens straight away.
  const pendingSetup = current?.profile.must_change_password
    ? { phone: current.profile.phone }
    : null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted/30 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <GraduationCap className="h-5 w-5" aria-hidden />
          </span>
          <CardTitle>Sign in to ClassroomOS</CardTitle>
          <p className="text-sm text-muted-foreground">
            Choose your school, then sign in with the details from your school office.
          </p>
        </CardHeader>
        <CardContent>
          <LoginForm
            schools={schools}
            role={role}
            initialSchool={initialSchool}
            next={next}
            pendingSetup={pendingSetup}
          />
        </CardContent>
      </Card>
      <Link
        href="/"
        className="mt-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to ClassroomOS
      </Link>
    </main>
  );
}
