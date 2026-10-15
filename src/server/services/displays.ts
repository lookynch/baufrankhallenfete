import { decrypt, encrypt, randomDigits, randomToken, sha256Hex, timingSafeEqual } from '../security/crypto.ts';

export const DISPLAY_COOKIE = '__Host-display';
export const displayKinds = ['tv', 'bar_stats', 'bar_ledger', 'player'] as const;
export type DisplayKind = (typeof displayKinds)[number];

const PAIRING_TTL_MS = 10 * 60_000;

export class DisplayError extends Error {}

export interface DisplayRow {
  id: number;
  name: string;
  kind: DisplayKind;
  last_seen_at: number | null;
}

export async function startPairing(
  db: D1Database,
  now: number,
): Promise<{ code: string; secret: string; expiresAt: number }> {
  await db.prepare('DELETE FROM display_pairings WHERE expires_at < ?1').bind(now).run();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomDigits(6);
    const secret = randomToken(24);
    const inserted = await db
      .prepare(
        'INSERT OR IGNORE INTO display_pairings (code, secret_hash, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)',
      )
      .bind(code, await sha256Hex(secret), now, now + PAIRING_TTL_MS)
      .run();
    if (inserted.meta.changes === 1) return { code, secret, expiresAt: now + PAIRING_TTL_MS };
  }
  throw new DisplayError('pairing_unavailable');
}

export async function claimPairing(
  db: D1Database,
  encKey: string,
  input: { code: string; name: string; kind: DisplayKind },
  userId: number,
  now: number,
): Promise<number> {
  const pairing = await db
    .prepare('SELECT code FROM display_pairings WHERE code = ?1 AND expires_at >= ?2 AND display_id IS NULL')
    .bind(input.code, now)
    .first<{ code: string }>();
  if (!pairing) throw new DisplayError('pairing_not_found');
  const token = randomToken(32);
  const display = await db
    .prepare(
      'INSERT INTO displays (name, kind, token_hash, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id',
    )
    .bind(input.name, input.kind, await sha256Hex(token), now, userId)
    .first<{ id: number }>();
  if (!display) throw new DisplayError('display_not_created');
  await db
    .prepare('UPDATE display_pairings SET display_id = ?2, token_enc = ?3 WHERE code = ?1 AND display_id IS NULL')
    .bind(input.code, display.id, await encrypt(encKey, token))
    .run();
  return display.id;
}

export async function pollPairing(
  db: D1Database,
  encKey: string,
  code: string,
  secret: string,
  now: number,
): Promise<{ status: 'pending' | 'expired' } | { status: 'paired'; token: string; kind: DisplayKind }> {
  const row = await db
    .prepare(
      `SELECT p.secret_hash, p.expires_at, p.token_enc, d.kind
       FROM display_pairings p LEFT JOIN displays d ON d.id = p.display_id WHERE p.code = ?1`,
    )
    .bind(code)
    .first<{ secret_hash: string; expires_at: number; token_enc: string | null; kind: DisplayKind | null }>();
  if (!row || !timingSafeEqual(row.secret_hash, await sha256Hex(secret))) return { status: 'expired' };
  if (row.token_enc && row.kind) {
    await db.prepare('DELETE FROM display_pairings WHERE code = ?1').bind(code).run();
    return { status: 'paired', token: await decrypt(encKey, row.token_enc), kind: row.kind };
  }
  return row.expires_at < now ? { status: 'expired' } : { status: 'pending' };
}

const lastSeenWrites = new Map<number, number>();

export async function authenticateDisplay(
  db: D1Database,
  token: string | undefined,
  now: number,
): Promise<DisplayRow | null> {
  if (!token || token.length > 100) return null;
  const display = await db
    .prepare('SELECT id, name, kind, last_seen_at FROM displays WHERE token_hash = ?1 AND revoked_at IS NULL')
    .bind(await sha256Hex(token))
    .first<DisplayRow>();
  if (!display) return null;
  if (now - (lastSeenWrites.get(display.id) ?? 0) > 60_000) {
    lastSeenWrites.set(display.id, now);
    await db.prepare('UPDATE displays SET last_seen_at = ?2 WHERE id = ?1').bind(display.id, now).run();
  }
  return display;
}
