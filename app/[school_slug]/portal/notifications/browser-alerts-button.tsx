'use client';

import * as React from 'react';
import { BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Asks for browser alert permission on a click, since browsers penalise asking
 * on page load. Hidden once the user has decided, or where alerts do not exist.
 */
export function BrowserAlertsButton() {
  const [askable, setAskable] = React.useState(false);

  React.useEffect(() => {
    setAskable(typeof Notification !== 'undefined' && Notification.permission === 'default');
  }, []);

  if (!askable) return null;

  return (
    <Button
      variant="outline"
      onClick={() => void Notification.requestPermission().then(() => setAskable(false))}
    >
      <BellRing className="h-4 w-4" aria-hidden />
      Turn on browser alerts
    </Button>
  );
}
