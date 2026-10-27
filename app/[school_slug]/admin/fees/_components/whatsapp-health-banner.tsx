import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import type { WhatsAppHealth } from '@/lib/whatsapp-health';
import { cn } from '@/lib/utils';

interface WhatsAppHealthBannerProps {
  health: WhatsAppHealth;
  /** Same page with the health cache bypassed. */
  recheckHref: string;
}

const TEMPLATE_STYLES: Record<string, string> = {
  APPROVED: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  PENDING: 'border-amber-200 bg-amber-50 text-amber-900',
  UNVERIFIED: 'border-slate-200 bg-slate-50 text-slate-700',
};

/**
 * Explains, on the Fees page, why WhatsApp messages (and fee reminders in
 * particular) will not go out, and how to fix it. Renders nothing when the
 * integration is healthy.
 */
export function WhatsAppHealthBanner({ health, recheckHref }: WhatsAppHealthBannerProps) {
  if (health.issues.length === 0) return null;

  const blocking = !health.remindersReady;

  return (
    <section
      role={blocking ? 'alert' : 'status'}
      aria-labelledby="whatsapp-health-title"
      className={cn(
        'rounded-lg border p-4 text-sm',
        blocking
          ? 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100'
          : 'border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-100',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div className="min-w-0 space-y-2">
            <h2 id="whatsapp-health-title" className="font-semibold">
              {blocking
                ? 'Fee reminders are turned off until WhatsApp is set up'
                : 'Some WhatsApp messages may not be delivered'}
            </h2>
            <ul className="list-disc space-y-1 pl-5">
              {health.issues.map((issue) => (
                <li key={issue} className="break-words">
                  {issue}
                </li>
              ))}
            </ul>
          </div>
        </div>
        {/* A full load on purpose: a client-side Link to the URL already open
            would be served from the router cache and never re-run the check. */}
        <a
          href={recheckHref}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-black/15 px-2.5 dark:border-white/20 py-1.5 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/10"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Check again
        </a>
      </div>

      {health.configured ? (
        <ul className="mt-3 flex flex-wrap gap-1.5 pl-8" aria-label="Template status">
          {health.templates.map((template) => (
            <li
              key={template.name}
              title={template.detail ?? template.purpose}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
                TEMPLATE_STYLES[template.status] ?? 'border-rose-200 bg-rose-50 text-rose-800',
              )}
            >
              {template.status === 'APPROVED' ? (
                <CheckCircle2 className="h-3 w-3" aria-hidden />
              ) : null}
              <span className="font-mono">{template.name}</span>
              <span className="opacity-75">· {template.status.toLowerCase()}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <details className="mt-3 pl-8">
        <summary className="cursor-pointer font-medium">How to set up WhatsApp</summary>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5">
          <li>
            In Meta Business Suite, add a phone number to your WhatsApp Business Account and create
            a permanent access token with the <span className="font-mono">whatsapp_business_messaging</span>{' '}
            and <span className="font-mono">whatsapp_business_management</span> permissions.
          </li>
          <li>
            Set <span className="font-mono">WHATSAPP_ACCESS_TOKEN</span>,{' '}
            <span className="font-mono">WHATSAPP_PHONE_NUMBER_ID</span> and{' '}
            <span className="font-mono">WHATSAPP_BUSINESS_ACCOUNT_ID</span> on the server, then
            redeploy. (For Interakt, set <span className="font-mono">WHATSAPP_PROVIDER=interakt</span>{' '}
            and <span className="font-mono">INTERAKT_API_KEY</span>.)
          </li>
          <li>
            In WhatsApp Manager, create each template above in the language{' '}
            <span className="font-mono">English (en)</span>, with the wording given in the README,
            and wait for Meta to approve it.
          </li>
          <li>Come back here and choose Check again.</li>
        </ol>
      </details>
    </section>
  );
}
