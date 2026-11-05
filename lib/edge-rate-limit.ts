/**
 * Rate limiting for the edge middleware.
 *
 * Two stores, chosen per route so Upstash Redis (a paid, per-command service)
 * is used only where a shared count matters:
 *
 *   redis   Money routes (/api/payments/, /api/payroll/). Fixed-window counts
 *           in Upstash over its REST API (one pipelined INCR + PEXPIRE per
 *           request, no client library, so it runs on the edge runtime), shared
 *           by every instance. Without UPSTASH_REDIS_REST_URL/TOKEN, or if
 *           Redis does not answer within 300 ms, these fall back to memory.
 *   memory  Everything else (/api/whatsapp/, /api/leave/, /api/storage/). A
 *           sliding-window log in this instance's memory: free, and enough to
 *           stop a burst from one client, though each instance counts
 *           separately.
 *
 * Deliberately no 'server-only' import: this module runs in middleware.
 */

export type RateLimitStore = 'redis' | 'memory';

export interface RateLimitRule {
  name: string;
  /** Requests allowed per client in each window. */
  limit: number;
  windowMs: number;
  store: RateLimitStore;
}

const RULES: { prefix: string; rule: RateLimitRule }[] = [
  { prefix: '/api/payments/', rule: { name: 'payments', limit: 20, windowMs: 60_000, store: 'redis' } },
  { prefix: '/api/payroll/', rule: { name: 'payroll', limit: 10, windowMs: 60_000, store: 'redis' } },
  { prefix: '/api/whatsapp/', rule: { name: 'whatsapp', limit: 20, windowMs: 60_000, store: 'memory' } },
  { prefix: '/api/leave/', rule: { name: 'leave', limit: 30, windowMs: 60_000, store: 'memory' } },
  { prefix: '/api/storage/', rule: { name: 'storage', limit: 60, windowMs: 60_000, store: 'memory' } },
];

export function rateLimitRuleFor(pathname: string): RateLimitRule | null {
  return RULES.find((entry) => pathname.startsWith(entry.prefix))?.rule ?? null;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  store: RateLimitStore;
}

/* ------------------------------------------------- in-memory sliding window */

/**
 * Timestamps of the requests each key made inside its window, oldest first.
 * A key holds at most `limit` entries (a refused request is not recorded), so
 * memory per client is bounded by the rule, not by how hard it hammers.
 */
const windows = new Map<string, number[]>();
const MAX_KEYS = 10_000;

function sweep(now: number) {
  for (const [key, stamps] of windows) {
    // Every rule's window is at most a few minutes; anything older is dead.
    if (stamps.length === 0 || now - stamps[stamps.length - 1] > 10 * 60_000) windows.delete(key);
  }
}

export function slidingWindow(key: string, rule: Pick<RateLimitRule, 'limit' | 'windowMs'>, now = Date.now()) {
  const cutoff = now - rule.windowMs;
  const stamps = (windows.get(key) ?? []).filter((stamp) => stamp > cutoff);

  if (stamps.length >= rule.limit) {
    windows.set(key, stamps);
    // Allowed again once the oldest request in the window ages out.
    const retryMs = stamps[0] + rule.windowMs - now;
    return {
      allowed: false,
      limit: rule.limit,
      remaining: 0,
      retryAfterSeconds: Math.max(Math.ceil(retryMs / 1000), 1),
      store: 'memory' as const,
    };
  }

  stamps.push(now);
  windows.set(key, stamps);
  if (windows.size > MAX_KEYS) sweep(now);
  return {
    allowed: true,
    limit: rule.limit,
    remaining: rule.limit - stamps.length,
    retryAfterSeconds: 0,
    store: 'memory' as const,
  };
}

/** Test hook: forget every in-memory count. */
export function resetMemoryRateLimits() {
  windows.clear();
}

/* ---------------------------------------------------- Upstash fixed window */

async function inRedis(key: string, rule: RateLimitRule, now: number): Promise<RateLimitDecision | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const window = Math.floor(now / rule.windowMs);
  const redisKey = `ratelimit:${key}:${window}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300);
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['INCR', redisKey],
        ['PEXPIRE', redisKey, String(rule.windowMs)],
      ]),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const [incr] = (await response.json()) as { result?: number }[];
    if (typeof incr?.result !== 'number') return null;
    const allowed = incr.result <= rule.limit;
    return {
      allowed,
      limit: rule.limit,
      remaining: Math.max(rule.limit - incr.result, 0),
      retryAfterSeconds: allowed ? 0 : Math.max(Math.ceil(((window + 1) * rule.windowMs - now) / 1000), 1),
      store: 'redis',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkRateLimit(key: string, rule: RateLimitRule): Promise<RateLimitDecision> {
  const now = Date.now();
  const scoped = `${rule.name}:${key}`;
  if (rule.store === 'redis') {
    const shared = await inRedis(scoped, rule, now);
    if (shared) return shared;
  }
  return slidingWindow(scoped, rule, now);
}
