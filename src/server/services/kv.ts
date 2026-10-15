export async function getKv<T>(db: D1Database, key: string): Promise<{ value: T; updatedAt: number } | null> {
  const row = await db
    .prepare('SELECT value, updated_at FROM kv WHERE key = ?1')
    .bind(key)
    .first<{ value: string; updated_at: number }>();
  if (!row) return null;
  try {
    return { value: JSON.parse(row.value) as T, updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

export async function setKv(db: D1Database, key: string, value: unknown, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO kv (key, value, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, JSON.stringify(value), now)
    .run();
}

export async function deleteKv(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM kv WHERE key = ?1').bind(key).run();
}

export async function tryLock(db: D1Database, key: string, now: number, ttlMs: number): Promise<boolean> {
  const lockKey = `lock:${key}`;
  const result = await db.batch([
    db
      .prepare(`INSERT OR IGNORE INTO kv (key, value, updated_at, lock_until) VALUES (?1, 'null', ?2, 0)`)
      .bind(lockKey, now),
    db
      .prepare(
        'UPDATE kv SET lock_until = ?2, updated_at = ?3 WHERE key = ?1 AND (lock_until IS NULL OR lock_until <= ?3)',
      )
      .bind(lockKey, now + ttlMs, now),
  ]);
  return (result[1]?.meta.changes ?? 0) === 1;
}

export async function releaseLock(db: D1Database, key: string): Promise<void> {
  await db.prepare('UPDATE kv SET lock_until = 0 WHERE key = ?1').bind(`lock:${key}`).run();
}
