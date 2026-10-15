import { randomToken, sha256Hex } from './crypto.ts';

export const ADMIN_COOKIE = '__Host-admin';
export const SESSION_IDLE_MS = 2 * 3_600_000;
export const SESSION_ABSOLUTE_MS = 12 * 3_600_000;
export const REAUTH_WINDOW_MS = 15 * 60_000;
const LAST_SEEN_RESOLUTION_MS = 5 * 60_000;

export interface AdminPrincipal {
  userId: number;
  username: string;
  displayName: string;
  role: 'owner' | 'admin';
  sessionHash: string;
  reauthAt: number;
}

export async function createSession(
  db: D1Database,
  userId: number,
  now: number,
  meta: { ipHash: string; userAgent: string },
): Promise<string> {
  const token = randomToken(32);
  await db
    .prepare(
      `INSERT INTO admin_sessions (token_hash, user_id, created_at, last_seen_at, expires_at, reauth_at, ip_hash, user_agent)
       VALUES (?1, ?2, ?3, ?3, ?4, ?3, ?5, ?6)`,
    )
    .bind(await sha256Hex(token), userId, now, now + SESSION_ABSOLUTE_MS, meta.ipHash, meta.userAgent.slice(0, 200))
    .run();
  return token;
}

export async function loadSession(db: D1Database, token: string | undefined, now: number): Promise<AdminPrincipal | null> {
  if (!token || token.length > 100) return null;
  const hash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT s.token_hash, s.last_seen_at, s.expires_at, s.reauth_at, u.id, u.username, u.display_name, u.role
       FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
       WHERE s.token_hash = ?1 AND u.disabled = 0`,
    )
    .bind(hash)
    .first<{
      token_hash: string;
      last_seen_at: number;
      expires_at: number;
      reauth_at: number;
      id: number;
      username: string;
      display_name: string;
      role: 'owner' | 'admin';
    }>();
  if (!row) return null;
  if (row.expires_at <= now || row.last_seen_at + SESSION_IDLE_MS <= now) {
    await db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?1').bind(hash).run();
    return null;
  }
  if (now - row.last_seen_at > LAST_SEEN_RESOLUTION_MS) {
    await db.prepare('UPDATE admin_sessions SET last_seen_at = ?2 WHERE token_hash = ?1').bind(hash, now).run();
  }
  return {
    userId: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    sessionHash: hash,
    reauthAt: row.reauth_at,
  };
}

export async function destroySession(db: D1Database, sessionHash: string): Promise<void> {
  await db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?1').bind(sessionHash).run();
}

export async function markReauth(db: D1Database, sessionHash: string, now: number): Promise<void> {
  await db.prepare('UPDATE admin_sessions SET reauth_at = ?2 WHERE token_hash = ?1').bind(sessionHash, now).run();
}

export function hasRecentReauth(principal: AdminPrincipal, now: number): boolean {
  return now - principal.reauthAt <= REAUTH_WINDOW_MS;
}
