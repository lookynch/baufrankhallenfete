export interface RateLimitResult {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
}

export async function hitRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowSeconds: number,
  now: number,
): Promise<RateLimitResult> {
  const windowMs = windowSeconds * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(key, windowStart)
    .first<{ count: number }>();
  const count = row?.count ?? limit + 1;
  return {
    allowed: count <= limit,
    count,
    retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)),
  };
}

export async function peekRateLimit(db: D1Database, key: string, windowSeconds: number, now: number): Promise<number> {
  const windowMs = windowSeconds * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const row = await db
    .prepare('SELECT count FROM rate_limits WHERE key = ?1 AND window_start = ?2')
    .bind(key, windowStart)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function clearRateLimit(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM rate_limits WHERE key = ?1').bind(key).run();
}

export async function pruneRateLimits(db: D1Database, now: number): Promise<void> {
  await db
    .prepare('DELETE FROM rate_limits WHERE window_start < ?1')
    .bind(now - 24 * 3_600_000)
    .run();
}
