// Best-effort in-memory rate limiter: max N requests per window per key.
//
// NOT effective as a real rate limit in production on serverless (Netlify):
// each function instance has its own Map, the count is not shared across
// instances, and the whole store is wiped on every cold start. Treat it as
// a light speed-bump against accidental bursts, not a security control.
// For enforced limits, move to a durable store (platform KV, Redis, or a
// Postgres atomic upsert).
//
// To bound memory on long-lived warm instances, expired entries are evicted
// lazily on each call and the store is capped at MAX_ENTRIES.

type Entry = { count: number; resetAt: number };

const store = new Map<string, Entry>();

// Hard cap so a flood of distinct keys (e.g. spoofed IPs) cannot grow the
// Map without bound. When exceeded, the oldest-expiring entries are dropped.
const MAX_ENTRIES = 10_000;

function evict(now: number): void {
  // Drop entries whose window has already elapsed.
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
  // If still over the cap, evict the entries that reset soonest.
  if (store.size > MAX_ENTRIES) {
    const sorted = [...store.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (let i = 0; i < store.size - MAX_ENTRIES; i++) {
      store.delete(sorted[i][0]);
    }
  }
}

export function rateLimit(
  key: string,
  { limit = 10, windowMs = 60_000 }: { limit?: number; windowMs?: number } = {},
): { allowed: boolean; remaining: number } {
  const now = Date.now();
  evict(now);
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1 };
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  entry.count++;
  return { allowed: true, remaining: limit - entry.count };
}

// Exposed for tests.
export const __testing = { store, MAX_ENTRIES };
