'use client';

import * as React from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/** Springy lift on hover and press. No initial state, so nothing is hidden before hydration. */
export function HoverLift({ children, className }: { children: React.ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      whileHover={reduce ? undefined : { y: -3 }}
      whileTap={reduce ? undefined : { scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      {children}
    </motion.div>
  );
}
