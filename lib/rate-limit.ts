/**
 * In-memory sliding-window limiter.
 *
 * The leaderboard's storage is a free JSONBin plan (10k requests/month), so an
 * open write endpoint could drain the whole game's quota in an afternoon. This
 * caps how often one browser can submit, and how many writes the process makes
 * in a window.
 *
 * Per-process, not distributed: on serverless each instance keeps its own
 * counters, which is still enough to stop a single client from hammering the
 * app (requests land on the same warm instance) without adding a database.
 */
export type RateLimitResult = { ok: true } | { ok: false; retryAfterMs: number };

export function createRateLimiter({
  limit,
  windowMs,
}: {
  limit: number;
  windowMs: number;
}): { take(key: string, now?: number): RateLimitResult } {
  const hits = new Map<string, number[]>();

  return {
    take(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);

      if (recent.length >= limit) {
        const oldest = recent[0] as number;
        hits.set(key, recent);
        return { ok: false, retryAfterMs: Math.max(0, windowMs - (now - oldest)) };
      }

      recent.push(now);
      hits.set(key, recent);

      // Keys are random per-browser ids; a bound keeps a long-lived process from
      // growing this map forever.
      if (hits.size > 5_000) {
        for (const [storedKey, timestamps] of hits) {
          if (timestamps.every((at) => now - at >= windowMs)) hits.delete(storedKey);
        }
      }

      return { ok: true };
    },
  };
}
