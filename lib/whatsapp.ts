import 'server-only';

import { optionalEnv, requireEnv } from '@/lib/env';
import { toE164India } from '@/lib/utils';

/**
 * WhatsApp delivery for parent-facing notifications.
 *
 * Two providers are supported and selected by WHATSAPP_PROVIDER:
 *   meta     - WhatsApp Business Cloud API (graph.facebook.com)
 *   interakt - Interakt's public API, common with Indian SMB deployments
 *
 * Notifications are never allowed to fail a user request. Every function here
 * resolves to a WhatsAppResult and logs; callers decide whether to surface it.
 */

export interface WhatsAppResult {
  ok: boolean;
  provider: 'meta' | 'interakt';
  messageId?: string;
  error?: string;
  skipped?: boolean;
}

export type Provider = 'meta' | 'interakt';

function provider(): Provider {
  return optionalEnv('WHATSAPP_PROVIDER', 'meta') === 'interakt' ? 'interakt' : 'meta';
}

/** Overridable like INTERAKT_BASE_URL, so tests can stand in for Meta. */
export function metaGraphBaseUrl(): string {
  return optionalEnv('WHATSAPP_GRAPH_BASE_URL', 'https://graph.facebook.com').replace(/\/$/, '');
}

export function metaApiVersion(): string {
  return optionalEnv('WHATSAPP_API_VERSION', 'v21.0');
}

export function whatsappProvider(): Provider {
  return provider();
}

function isConfigured(p: Provider): boolean {
  if (p === 'interakt') return Boolean(process.env.INTERAKT_API_KEY);
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/** Whether a send would reach a provider, so bulk senders can stop before looping. */
export function isWhatsAppConfigured(): boolean {
  return isConfigured(provider());
}

/** A template parameter as both providers model it: an ordered list of strings. */
export interface TemplateMessage {
  to: string;
  templateName: string;
  languageCode?: string;
  bodyParams: string[];
  /** Appended as a dynamic URL suffix on a call-to-action button, if the template has one. */
  buttonUrlSuffix?: string;
}

async function sendViaMeta(message: TemplateMessage, phone: string): Promise<WhatsAppResult> {
  const version = metaApiVersion();
  const phoneNumberId = requireEnv('WHATSAPP_PHONE_NUMBER_ID');
  const token = requireEnv('WHATSAPP_ACCESS_TOKEN');

  const components: Record<string, unknown>[] = [
    {
      type: 'body',
      parameters: message.bodyParams.map((text) => ({ type: 'text', text })),
    },
  ];

  if (message.buttonUrlSuffix) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: message.buttonUrlSuffix }],
    });
  }

  const response = await fetch(`${metaGraphBaseUrl()}/${version}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'template',
      template: {
        name: message.templateName,
        language: { code: message.languageCode ?? 'en' },
        components,
      },
    }),
    cache: 'no-store',
  });

  const payload = (await response.json().catch(() => ({}))) as {
    messages?: { id: string }[];
    error?: { message?: string };
  };

  if (!response.ok) {
    return {
      ok: false,
      provider: 'meta',
      error: payload.error?.message ?? `HTTP ${response.status}`,
    };
  }

  return { ok: true, provider: 'meta', messageId: payload.messages?.[0]?.id };
}

async function sendViaInterakt(message: TemplateMessage, phone: string): Promise<WhatsAppResult> {
  const apiKey = requireEnv('INTERAKT_API_KEY');
  const baseUrl = optionalEnv('INTERAKT_BASE_URL', 'https://api.interakt.ai/v1/public');
  const countryCode = optionalEnv('WHATSAPP_DEFAULT_COUNTRY_CODE', '91');

  const response = await fetch(`${baseUrl}/message/`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      countryCode: `+${countryCode}`,
      phoneNumber: phone.slice(-10),
      type: 'Template',
      template: {
        name: message.templateName,
        languageCode: message.languageCode ?? 'en',
        bodyValues: message.bodyParams,
        ...(message.buttonUrlSuffix ? { buttonValues: { '0': [message.buttonUrlSuffix] } } : {}),
      },
    }),
    cache: 'no-store',
  });

  const payload = (await response.json().catch(() => ({}))) as {
    id?: string;
    result?: boolean;
    message?: string;
  };

  if (!response.ok || payload.result === false) {
    return {
      ok: false,
      provider: 'interakt',
      error: payload.message ?? `HTTP ${response.status}`,
    };
  }

  return { ok: true, provider: 'interakt', messageId: payload.id };
}

/** Low-level send. Prefer the named notification helpers below. */
export async function sendTemplateMessage(message: TemplateMessage): Promise<WhatsAppResult> {
  const active = provider();

  if (!isConfigured(active)) {
    console.warn('[whatsapp] provider not configured, skipping send', {
      provider: active,
      template: message.templateName,
    });
    return { ok: false, provider: active, skipped: true, error: 'provider not configured' };
  }

  const phone = toE164India(message.to, optionalEnv('WHATSAPP_DEFAULT_COUNTRY_CODE', '91'));
  if (!phone) {
    return { ok: false, provider: active, error: `unusable phone number: ${message.to}` };
  }

  try {
    const result =
      active === 'interakt'
        ? await sendViaInterakt(message, phone)
        : await sendViaMeta(message, phone);

    if (!result.ok) {
      console.error('[whatsapp] send failed', { template: message.templateName, error: result.error });
    }
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown transport error';
    console.error('[whatsapp] transport error', { template: message.templateName, reason });
    return { ok: false, provider: active, error: reason };
  }
}

/* ---------------------------------------------------------------------------
 * Named notifications. Template names match the approved WABA templates listed
 * in README.md; keep the parameter order in sync with the template bodies.
 * ------------------------------------------------------------------------- */

export interface AdmissionAckParams {
  parentPhone: string;
  parentName: string;
  applicantName: string;
  schoolName: string;
  targetGrade: string;
  schoolPhone?: string | null;
}

/**
 * Template `admission_enquiry_ack`:
 * "Hello {{1}}, we have received your admission enquiry for {{2}} (Grade {{3}})
 *  at {{4}}. Our admissions team will call you on {{5}}."
 */
export function sendAdmissionAcknowledgement(params: AdmissionAckParams): Promise<WhatsAppResult> {
  return sendTemplateMessage({
    to: params.parentPhone,
    templateName: 'admission_enquiry_ack',
    bodyParams: [
      params.parentName,
      params.applicantName,
      params.targetGrade,
      params.schoolName,
      params.schoolPhone ?? 'the number on our website',
    ],
  });
}

export interface PaymentConfirmationParams {
  parentPhone: string;
  parentName: string;
  studentName: string;
  schoolName: string;
  amountPaid: string;
  receiptNumber: string;
  outstandingBalance: string;
  /** Path portion appended to the template's CTA button, e.g. `receipts/<id>`. */
  receiptPathSuffix: string;
}

/**
 * Template `fee_payment_confirmation`:
 * "Dear {{1}}, we have received {{2}} towards fees for {{3}} at {{4}}.
 *  Receipt no: {{5}}. Outstanding balance: {{6}}."
 * with a dynamic URL button pointing at the receipt PDF.
 */
export function sendPaymentConfirmation(params: PaymentConfirmationParams): Promise<WhatsAppResult> {
  return sendTemplateMessage({
    to: params.parentPhone,
    templateName: 'fee_payment_confirmation',
    bodyParams: [
      params.parentName,
      params.amountPaid,
      params.studentName,
      params.schoolName,
      params.receiptNumber,
      params.outstandingBalance,
    ],
    buttonUrlSuffix: params.receiptPathSuffix,
  });
}

export interface AbsenceAlertParams {
  parentPhone: string;
  parentName: string;
  studentName: string;
  schoolName: string;
  date: string;
}

/**
 * Template `student_absence_alert`:
 * "Dear {{1}}, {{2}} was marked absent at {{3}} on {{4}}."
 */
export function sendAbsenceAlert(params: AbsenceAlertParams): Promise<WhatsAppResult> {
  return sendTemplateMessage({
    to: params.parentPhone,
    templateName: 'student_absence_alert',
    bodyParams: [params.parentName, params.studentName, params.schoolName, params.date],
  });
}

export interface FeeDueReminderParams {
  parentPhone: string;
  parentName: string;
  studentName: string;
  schoolName: string;
  outstandingBalance: string;
  /** Path appended to the template's CTA button, e.g. `<slug>/portal/fees`. */
  portalPathSuffix: string;
}

/**
 * Template `fee_due_reminder`:
 * "Dear {{1}}, {{2}} is outstanding towards fees for {{3}} at {{4}}. You can
 *  pay online from the parent portal."
 * with a dynamic URL button pointing at the portal's fees page.
 */
export function sendFeeDueReminder(params: FeeDueReminderParams): Promise<WhatsAppResult> {
  return sendTemplateMessage({
    to: params.parentPhone,
    templateName: 'fee_due_reminder',
    bodyParams: [
      params.parentName,
      params.outstandingBalance,
      params.studentName,
      params.schoolName,
    ],
    buttonUrlSuffix: params.portalPathSuffix,
  });
}
