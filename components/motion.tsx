import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Entrance animations for server-rendered content, in plain CSS
 * (tailwindcss-animate). They run before and without JavaScript, so content
 * is never held invisible waiting for hydration on a slow phone, and they
 * switch off under prefers-reduced-motion.
 *
 * Interactive motion (hover lift, swipe, nav indicators) uses Framer Motion
 * in client components; see components/hover-lift.tsx.
 */

const ENTER =
  'animate-in fade-in-0 slide-in-from-bottom-2 duration-300 ease-out fill-mode-both motion-reduce:animate-none';

export function FadeIn({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <div className={cn(ENTER, className)} style={delay ? { animationDelay: `${delay}s` } : undefined}>
      {children}
    </div>
  );
}

/** Each child fades in 50 ms after the one before it. */
export function Stagger({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      {React.Children.map(children, (child, index) => (
        <div className={ENTER} style={{ animationDelay: `${Math.min(index, 10) * 0.05}s` }}>
          {child}
        </div>
      ))}
    </div>
  );
}

export { HoverLift } from '@/components/hover-lift';
