'use client';

import * as React from 'react';
import { Loader2, Trash2 } from 'lucide-react';
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
import { useToast } from '@/components/ui/use-toast';
import { deleteFeeStructure } from '../../actions';

interface DeleteFeeHeadButtonProps {
  schoolSlug: string;
  feeStructureId: string;
  title: string;
}

export function DeleteFeeHeadButton({ schoolSlug, feeStructureId, title }: DeleteFeeHeadButtonProps) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const { toast } = useToast();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteFeeStructure(schoolSlug, feeStructureId);
      if (!result.ok) {
        toast({ variant: 'destructive', title: 'Could not remove fee head', description: result.error });
        return;
      }
      toast({ title: `${title} removed` });
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={`Remove ${title}`}>
          <Trash2 className="h-4 w-4 text-muted-foreground" aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Remove fee head?</DialogTitle>
          <DialogDescription>
            {title} will be removed from the schedule and from the dues of every active student in
            that class. Payments already made are kept.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
