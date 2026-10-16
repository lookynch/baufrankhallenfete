import { legal } from '../../shared/legal.ts';
import { SESSION_IDLE_MS } from '../security/session.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ARTIST_TAGS_DAYS = 30;
const SQL_NOW = "(CAST(strftime('%s', 'now') AS INTEGER) * 1000)";

export function retentionStatements(now: string, purgeGuests: boolean): string[] {
  const { guestDays, shortHours, auditDays, adminDays } = legal.retention;
  const guest = purgeGuests ? now : `${now} - ${guestDays * DAY}`;
  const short = purgeGuests ? now : `${now} - ${shortHours * HOUR}`;
  return [
    `DELETE FROM votes WHERE updated_at <= ${guest}`,
    `DELETE FROM devices WHERE last_seen_at <= ${guest}`,
    `UPDATE wishes SET device_id = 'anon' WHERE device_id <> 'anon' AND created_at <= ${guest}`,
    `UPDATE wish_upvotes SET device_id = 'anon-' || rowid, ip_key = NULL WHERE created_at <= ${guest} AND (ip_key IS NOT NULL OR device_id NOT LIKE 'anon-%')`,
    `DELETE FROM search_cache WHERE fetched_at <= ${short}`,
    `DELETE FROM artist_tags WHERE max(fetched_at, COALESCE(failed_until, 0)) <= ${now} - ${ARTIST_TAGS_DAYS * DAY}`,
    `DELETE FROM rate_limits WHERE window_start <= ${short}`,
    `UPDATE audit_log SET ip_hash = NULL WHERE ip_hash IS NOT NULL AND at <= ${guest}`,
    `UPDATE audit_log SET after_json = json_remove(after_json, '$.ipKeyPrefix') WHERE action = 'votes_invalidate' AND at <= ${guest} AND json_extract(after_json, '$.ipKeyPrefix') IS NOT NULL`,
    `DELETE FROM audit_log WHERE at <= ${now} - ${auditDays * DAY}`,
    `DELETE FROM admin_sessions WHERE expires_at <= ${now} OR last_seen_at <= ${now} - ${SESSION_IDLE_MS}`,
    `DELETE FROM webauthn_challenges WHERE expires_at <= ${now}`,
    `DELETE FROM admin_invites WHERE expires_at <= ${now} - ${adminDays * DAY}`,
    `DELETE FROM admin_users WHERE disabled = 1 AND COALESCE(last_login_at, created_at) <= ${now} - ${adminDays * DAY}`,
    `INSERT INTO kv (key, value, updated_at) VALUES ('retention_run', 'true', ${now}) ON CONFLICT (key) DO UPDATE SET updated_at = excluded.updated_at`,
  ];
}

export const RETENTION_SQL = `${retentionStatements(SQL_NOW, false).join(';\n')};\n`;

export async function purgeNow(db: D1Database, now: number): Promise<{ votes: number; devices: number }> {
  const [votes, devices] = await db.batch(retentionStatements('?1', true).map((sql) => db.prepare(sql).bind(now)));
  return { votes: votes?.meta.changes ?? 0, devices: devices?.meta.changes ?? 0 };
}

export function forgetDeviceStatements(db: D1Database, deviceId: string): D1PreparedStatement[] {
  return [
    'DELETE FROM votes WHERE device_id = ?1',
    'DELETE FROM devices WHERE id = ?1',
    "UPDATE wishes SET device_id = 'anon' WHERE device_id = ?1",
    'DELETE FROM wish_upvotes WHERE device_id = ?1',
    "DELETE FROM rate_limits WHERE substr(key, -length(?1) - 1) = ':' || ?1",
  ].map((sql) => db.prepare(sql).bind(deviceId));
}
