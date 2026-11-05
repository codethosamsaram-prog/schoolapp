'use client';

import * as React from 'react';
import { CheckCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { markNotificationsRead } from '../actions';

export function MarkReadButton({ schoolSlug }: { schoolSlug: string }) {
  const [pending, startTransition] = React.useTransition();
  const { toast } = useToast();

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await markNotificationsRead(schoolSlug);
          if (!result.ok) toast({ variant: 'destructive', title: 'Not updated', description: result.error });
        })
      }
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCheck className="h-4 w-4" aria-hidden />}
      Mark all as read
    </Button>
  );
}
