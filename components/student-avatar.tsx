/* eslint-disable @next/next/no-img-element -- signed Supabase URLs expire hourly; next/image would cache them */
import { cn, initials } from '@/lib/utils';

interface StudentAvatarProps {
  src: string | null | undefined;
  name: string;
  className?: string;
}

/** Photo from a signed URL, or the student's initials when there is none. */
export function StudentAvatar({ src, name, className }: StudentAvatarProps) {
  return (
    <span
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 font-semibold text-primary',
        className,
      )}
    >
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover" draggable={false} />
      ) : (
        <span aria-hidden>{initials(name)}</span>
      )}
      {src ? null : <span className="sr-only">{name}</span>}
    </span>
  );
}
