// Fixed-window in-memory rate limiter for the public link routes.
// Best effort on serverless: each instance keeps its own counts and loses them on a cold
// start, so this slows casual token guessing but is not a hard limit.

type Bucket = { windowStart: number; count: number };

export const PUBLIC_LIMIT = { limit: 30, windowMs: 60_000 };

const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number } = PUBLIC_LIMIT,
  now: number = Date.now(),
): { allowed: boolean; retryAfterSeconds: number } {
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) if (now - b.windowStart >= opts.windowMs) buckets.delete(k);
  }
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= opts.windowMs) {
    bucket = { windowStart: now, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  const allowed = bucket.count <= opts.limit;
  return { allowed, retryAfterSeconds: allowed ? 0 : Math.ceil((bucket.windowStart + opts.windowMs - now) / 1000) };
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export function resetRateLimits(): void {
  buckets.clear();
}
