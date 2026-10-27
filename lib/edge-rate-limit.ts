/**
 * Fixed-window rate limiting for the edge middleware.
 *
 * With UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN set, counts live
 * in Upstash Redis (one INCR per request over its REST API, so it runs on the
 * edge runtime without a client library) and hold across every serverless
 * instance. Without them, or if Redis does not answer within 300 ms, counts
 * live in this instance's memory: that still stops a burst from one client,
 * but each instance counts separately.
 *
 * Deliberately no 'server-only' import: this module runs in middleware.
 */

export interface RateLimitRule {
  name: string;
  /** Requests allowed per client in each window. */
  limit: number;
  windowMs: number;
}

/** Sensitive routes: money, salaries, and the WhatsApp integration. */
const RULES: { prefix: string; rule: RateLimitRule }[] = [
  { prefix: '/api/payments/', rule: { name: 'payments', limit: 20, windowMs: 60_000 } },
  { prefix: '/api/payroll/', rule: { name: 'payroll', limit: 10, windowMs: 60_000 } },
  { prefix: '/api/whatsapp/', rule: { name: 'whatsapp', limit: 20, windowMs: 60_000 } },
];

export function rateLimitRuleFor(pathname: string): RateLimitRule | null {
  return RULES.find((entry) => pathname.startsWith(entry.prefix))?.rule ?? null;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  store: 'redis' | 'memory';
}

const memory = new Map<string, { count: number; resetAt: number }>();

function inMemory(key: string, rule: RateLimitRule, now: number): RateLimitDecision {
  const bucket = memory.get(key);
  if (!bucket || bucket.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + rule.windowMs });
    if (memory.size > 10_000) {
      for (const [entry, value] of memory) if (value.resetAt <= now) memory.delete(entry);
    }
    return { allowed: true, limit: rule.limit, remaining: rule.limit - 1, retryAfterSeconds: 0, store: 'memory' };
  }
  bucket.count += 1;
  return decide(bucket.count, rule, bucket.resetAt - now, 'memory');
}

function decide(count: number, rule: RateLimitRule, msLeft: number, store: RateLimitDecision['store']) {
  const allowed = count <= rule.limit;
  return {
    allowed,
    limit: rule.limit,
    remaining: Math.max(rule.limit - count, 0),
    retryAfterSeconds: allowed ? 0 : Math.max(Math.ceil(msLeft / 1000), 1),
    store,
  };
}

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
    return decide(incr.result, rule, (window + 1) * rule.windowMs - now, 'redis');
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkRateLimit(key: string, rule: RateLimitRule): Promise<RateLimitDecision> {
  const now = Date.now();
  return (await inRedis(`${rule.name}:${key}`, rule, now)) ?? inMemory(`${rule.name}:${key}`, rule, now);
}
