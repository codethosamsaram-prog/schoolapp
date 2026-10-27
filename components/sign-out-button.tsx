import { LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SignOutButtonProps {
  className?: string;
  showLabel?: boolean;
}

/** Plain form post, so it works before hydration and from Server Components. */
export function SignOutButton({ className, showLabel = true }: SignOutButtonProps) {
  return (
    <form action="/auth/sign-out" method="post">
      <button
        type="submit"
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
          className,
        )}
        aria-label="Sign out"
      >
        <LogOut className="h-4 w-4" aria-hidden />
        {showLabel ? <span>Sign out</span> : null}
      </button>
    </form>
  );
}
