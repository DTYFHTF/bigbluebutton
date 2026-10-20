// Fixed-window, in-memory rate limiter keyed by client IP. It only protects
// a single server instance; use a shared store (e.g. Redis) when scaling out.

const LIMIT = Number(process.env.HUMANLY_RATE_LIMIT_PER_MIN ?? 20);
const WINDOW_MS = 60_000;

const windows = new Map<string, { start: number; count: number }>();

export function checkRateLimit(key: string, now = Date.now()): { ok: boolean; retryAfter: number } {
  const entry = windows.get(key);
  if (!entry || now - entry.start >= WINDOW_MS) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 10_000) prune(now);
    return { ok: true, retryAfter: 0 };
  }
  if (entry.count >= LIMIT) {
    return { ok: false, retryAfter: Math.ceil((entry.start + WINDOW_MS - now) / 1000) };
  }
  entry.count++;
  return { ok: true, retryAfter: 0 };
}

function prune(now: number) {
  for (const [key, entry] of windows) {
    if (now - entry.start >= WINDOW_MS) windows.delete(key);
  }
}

export function clientKey(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0].trim() || headers.get("x-real-ip") || "local";
}
