import 'server-only';

import type { NotificationType } from '@/types/database';
import { createAdminClient } from '@/lib/supabase/admin';
import type { WhatsAppResult } from '@/lib/whatsapp';

/**
 * Family notifications, in-app first.
 *
 * Every notification is written to the `notifications` ledger for the
 * student's own login and their parent's; the portal shows it at once over
 * Supabase Realtime, at no per-message cost. WhatsApp (a paid template
 * message) is sent only when:
 *   - priority is CRITICAL, or
 *   - the family has no portal login to receive it in-app, so the message
 *     would otherwise reach nobody.
 *
 * Like the WhatsApp helpers, this never throws: a notification must not fail
 * the request that caused it.
 */

export type NotificationPriority = 'ROUTINE' | 'CRITICAL';

export interface FamilyNotification {
  schoolId: string;
  studentId: string;
  title: string;
  body: string;
  type: NotificationType;
  /** In-app path to open, e.g. `/<slug>/portal/fees`. */
  link?: string;
  priority?: NotificationPriority;
  /** The WhatsApp equivalent, sent only under the rules above. */
  whatsapp?: () => Promise<WhatsAppResult>;
}

export interface NotificationOutcome {
  /** Portal logins the notification was written for. */
  inApp: number;
  /** Set when WhatsApp was attempted. */
  whatsapp: WhatsAppResult | null;
}

/** True when the family got the message on at least one channel. */
export function wasDelivered(outcome: NotificationOutcome): boolean {
  return outcome.inApp > 0 || Boolean(outcome.whatsapp?.ok);
}

/** Portal logins per student: the student's own and the parent's. */
async function familyLogins(studentIds: string[]): Promise<Map<string, string[]>> {
  const logins = new Map<string, string[]>();
  if (studentIds.length === 0) return logins;

  const { data, error } = await createAdminClient()
    .from('students')
    .select('id, user_id, parent_user_id')
    .in('id', studentIds);
  if (error) {
    console.error('[notifications] recipient lookup failed', { error: error.message });
    return logins;
  }
  for (const row of data ?? []) {
    logins.set(row.id, [...new Set([row.user_id, row.parent_user_id].filter((id): id is string => Boolean(id)))]);
  }
  return logins;
}

/**
 * Notifies many families at once: one recipient lookup and one insert for
 * the in-app part, then WhatsApp only where the rules call for it. Results
 * are in input order.
 */
export async function notifyFamilies(items: FamilyNotification[]): Promise<NotificationOutcome[]> {
  const logins = await familyLogins([...new Set(items.map((item) => item.studentId))]);

  const rows = items.flatMap((item) =>
    (logins.get(item.studentId) ?? []).map((userId) => ({
      school_id: item.schoolId,
      user_id: userId,
      title: item.title.slice(0, 150),
      body: item.body.slice(0, 1000),
      type: item.type,
      link: item.link ?? null,
    })),
  );

  let written = rows.length > 0;
  if (rows.length > 0) {
    const { error } = await createAdminClient().from('notifications').insert(rows);
    if (error) {
      console.error('[notifications] insert failed', { error: error.message, count: rows.length });
      written = false;
    }
  }

  const outcomes: NotificationOutcome[] = [];
  for (const item of items) {
    const inApp = written ? logins.get(item.studentId)?.length ?? 0 : 0;
    const needsWhatsApp = item.priority === 'CRITICAL' || inApp === 0;
    let whatsapp: WhatsAppResult | null = null;
    if (needsWhatsApp && item.whatsapp) {
      // Sequential on purpose: WhatsApp throttles aggressively per number.
      whatsapp = await item.whatsapp().catch((error: unknown) => ({
        ok: false,
        provider: 'meta' as const,
        error: error instanceof Error ? error.message : 'unknown',
      }));
    }
    outcomes.push({ inApp, whatsapp });
  }
  return outcomes;
}

export async function notifyFamily(item: FamilyNotification): Promise<NotificationOutcome> {
  const [outcome] = await notifyFamilies([item]);
  return outcome;
}
