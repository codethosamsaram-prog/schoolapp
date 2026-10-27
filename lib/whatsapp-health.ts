import 'server-only';

import { optionalEnv } from '@/lib/env';
import {
  isWhatsAppConfigured,
  metaApiVersion,
  metaGraphBaseUrl,
  whatsappProvider,
  type Provider,
} from '@/lib/whatsapp';

/**
 * Diagnoses the WhatsApp integration: are the credentials present, does the
 * provider accept them, and is every template the app sends approved in the
 * language it is sent in.
 *
 * Meta exposes both checks. Template status needs the WhatsApp Business
 * Account id (WHATSAPP_BUSINESS_ACCOUNT_ID), which sending does not; without
 * it the templates are reported as unverified rather than guessed. Interakt
 * has no documented API for either, so only presence of the key is checked.
 */

/** Every template the app sends, and what breaks without it. */
export const REQUIRED_TEMPLATES = [
  { name: 'fee_due_reminder', purpose: 'Fee reminders' },
  { name: 'fee_payment_confirmation', purpose: 'Payment receipts' },
  { name: 'student_absence_alert', purpose: 'Absence alerts' },
  { name: 'admission_enquiry_ack', purpose: 'Admission enquiry replies' },
] as const;

export type TemplateName = (typeof REQUIRED_TEMPLATES)[number]['name'];

/** The language every send uses (see sendTemplateMessage). */
const SEND_LANGUAGE = 'en';

export interface TemplateHealth {
  name: TemplateName;
  purpose: string;
  /**
   * Meta's own status (APPROVED, PENDING, REJECTED, PAUSED, DISABLED, ...),
   * MISSING when no template has this name and language, or UNVERIFIED when
   * it could not be checked.
   */
  status: string;
  detail?: string;
}

export interface WhatsAppHealth {
  provider: Provider;
  /** Credentials needed to send are present. */
  configured: boolean;
  missingEnv: string[];
  credentials: 'valid' | 'invalid' | 'unchecked';
  credentialDetail?: string;
  /** The sending number as Meta reports it, when credentials were checked. */
  phoneNumber?: string;
  templatesVerified: boolean;
  templates: TemplateHealth[];
  /** Fee reminders can be expected to deliver. */
  remindersReady: boolean;
  /** Plain-language problems for the admin, most important first. */
  issues: string[];
  checkedAt: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;

let cached: { value: WhatsAppHealth; expires: number } | null = null;

/** Cached for five minutes, since it runs on every Fees page render. */
export async function getWhatsAppHealth(options: { fresh?: boolean } = {}): Promise<WhatsAppHealth> {
  if (!options.fresh && cached && cached.expires > Date.now()) return cached.value;
  const value = await checkWhatsAppHealth();
  cached = { value, expires: Date.now() + CACHE_TTL_MS };
  return value;
}

async function checkWhatsAppHealth(): Promise<WhatsAppHealth> {
  const provider = whatsappProvider();
  const missingEnv =
    provider === 'interakt'
      ? missing(['INTERAKT_API_KEY'])
      : missing(['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID']);

  const health: WhatsAppHealth = {
    provider,
    configured: isWhatsAppConfigured(),
    missingEnv,
    credentials: 'unchecked',
    templatesVerified: false,
    templates: REQUIRED_TEMPLATES.map((template) => ({ ...template, status: 'UNVERIFIED' })),
    remindersReady: false,
    issues: [],
    checkedAt: new Date().toISOString(),
  };

  if (!health.configured) {
    health.issues.push(`WhatsApp is not configured: set ${missingEnv.join(' and ')}.`);
    return health;
  }

  if (provider === 'meta') {
    await checkMeta(health);
  } else {
    health.issues.push(
      'Interakt credentials are set, but Interakt cannot be checked automatically. Confirm the templates are approved in the Interakt dashboard.',
    );
  }

  const reminder = health.templates.find((template) => template.name === 'fee_due_reminder');
  health.remindersReady =
    health.credentials !== 'invalid' &&
    (!health.templatesVerified || reminder?.status === 'APPROVED');

  return health;
}

async function checkMeta(health: WhatsAppHealth) {
  const token = optionalEnv('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = optionalEnv('WHATSAPP_PHONE_NUMBER_ID');
  const accountId = optionalEnv('WHATSAPP_BUSINESS_ACCOUNT_ID');
  const base = `${metaGraphBaseUrl()}/${metaApiVersion()}`;

  const phone = await graphGet<{ display_phone_number?: string; verified_name?: string }>(
    `${base}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`,
    token,
  );

  if (!phone.ok) {
    health.credentials = 'invalid';
    health.credentialDetail = phone.error;
    health.issues.push(
      `Meta rejected the access token or phone number id: ${phone.error}. Messages will not send.`,
    );
    return;
  }

  health.credentials = 'valid';
  health.phoneNumber = [phone.data.display_phone_number, phone.data.verified_name]
    .filter(Boolean)
    .join(' · ');

  if (!accountId) {
    health.issues.push(
      'Set WHATSAPP_BUSINESS_ACCOUNT_ID to check template approval. Until then, template status is unknown.',
    );
    return;
  }

  const results = await Promise.all(
    health.templates.map(async (template) => {
      const response = await graphGet<{
        data?: { name: string; status: string; language: string; rejected_reason?: string }[];
      }>(
        `${base}/${encodeURIComponent(accountId)}/message_templates?name=${encodeURIComponent(template.name)}&fields=name,status,language,rejected_reason&limit=50`,
        token,
      );
      if (!response.ok) return { ...template, status: 'UNVERIFIED', detail: response.error };

      // The name filter is a prefix match, so compare exactly.
      const variants = (response.data.data ?? []).filter((row) => row.name === template.name);
      const match = variants.find((row) => row.language === SEND_LANGUAGE);
      if (match) {
        return {
          ...template,
          status: match.status.toUpperCase(),
          detail:
            match.rejected_reason && match.rejected_reason !== 'NONE'
              ? `Rejected: ${match.rejected_reason}`
              : undefined,
        };
      }
      if (variants.length > 0) {
        return {
          ...template,
          status: 'MISSING',
          detail: `Exists in ${variants.map((row) => row.language).join(', ')}, but the app sends in "${SEND_LANGUAGE}".`,
        };
      }
      return { ...template, status: 'MISSING' };
    }),
  );

  health.templates = results;
  health.templatesVerified = results.every((template) => template.status !== 'UNVERIFIED');

  for (const template of results) {
    if (template.status === 'APPROVED') continue;
    if (template.status === 'UNVERIFIED') {
      health.issues.push(`Could not check "${template.name}": ${template.detail ?? 'no response'}.`);
    } else {
      health.issues.push(
        `${template.purpose} will not send: template "${template.name}" is ${template.status.toLowerCase()}${template.detail ? ` (${template.detail})` : ''}.`,
      );
    }
  }
}

function missing(names: string[]): string[] {
  return names.filter((name) => !optionalEnv(name));
}

type GraphResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function graphGet<T>(url: string, token: string): Promise<GraphResult<T>> {
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!response.ok) {
      return { ok: false, error: payload.error?.message ?? `HTTP ${response.status}` };
    }
    return { ok: true, data: payload };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : 'unreachable',
    };
  }
}
