import Link from 'next/link';
import { SchoolIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function TenantNotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
      <SchoolIcon className="h-10 w-10 text-muted-foreground" aria-hidden />
      <h1 className="text-2xl font-semibold">We could not find that school</h1>
      <p className="text-muted-foreground">
        The portal address may have changed, or the institution is no longer active on ClassroomOS.
      </p>
      <Button asChild variant="outline">
        <Link href="/">Back to ClassroomOS</Link>
      </Button>
    </main>
  );
}
