'use client';

import * as React from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import type { ActionResult } from '@/types/database';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

interface DeleteItemButtonProps {
  /** A Server Action with its arguments already bound. */
  action: () => Promise<ActionResult<unknown>>;
  label: string;
  confirmText?: string;
}

/** Icon button that runs a bound delete action after a native confirm. */
export function DeleteItemButton({ action, label, confirmText }: DeleteItemButtonProps) {
  const [pending, startTransition] = React.useTransition();
  const { toast } = useToast();

  function onClick() {
    if (confirmText && !window.confirm(confirmText)) return;
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Not removed', description: result.error });
      } else {
        toast({ title: 'Removed' });
      }
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-destructive"
      onClick={onClick}
      disabled={pending}
      aria-label={label}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
    </Button>
  );
}
