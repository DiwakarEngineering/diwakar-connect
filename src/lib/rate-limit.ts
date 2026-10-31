import "server-only";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/**
 * Fixed-window limiter kept in this server instance's memory. It is a first
 * line of defense only; invitation and call endpoints also apply durable,
 * database-backed limits (see the route handlers).
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    return { ok: true, retryAfter: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}
