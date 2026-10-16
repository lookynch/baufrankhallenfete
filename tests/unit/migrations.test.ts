import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/d1.ts';

const migration0003 = readFileSync(join(import.meta.dirname, '..', '..', 'migrations', '0003_datenschutz.sql'), 'utf8');

describe('Migration 0003', () => {
  it('entfernt Gerätesignaturen, Session-Metadaten und Klartext-Login-Schlüssel', async () => {
    const db = createTestDb();
    await db.batch([
      db.prepare("UPDATE kv SET value = '2' WHERE key = 'schema_version'"),
      db.prepare(
        "INSERT INTO devices (id, created_at, fp_hash, ip_key, last_seen_at) VALUES ('dev', 1, 'fp', 'ip', 1)",
      ),
      db.prepare("INSERT INTO rounds (id, seq, status, mood_level, opened_at) VALUES (1, 1, 'closed', 2, 0)"),
      db.prepare(
        "INSERT INTO votes (round_id, device_id, ip_key, fp_hash, song_id, created_at, updated_at) VALUES (1, 'dev', 'ip', 'fp', 1, 1, 1)",
      ),
      db.prepare(
        "INSERT INTO admin_users (id, username, display_name, role, password_hash, totp_secret_enc, created_at) VALUES (1, 'anna', 'Anna', 'owner', 'x', 'x', 0)",
      ),
      db.prepare(
        "INSERT INTO admin_sessions (token_hash, user_id, created_at, last_seen_at, expires_at, reauth_at, ip_hash, user_agent) VALUES ('t', 1, 0, 0, 1, 0, 'iph', 'Mozilla/5.0')",
      ),
      db.prepare(
        `INSERT INTO audit_log (at, user_id, action, entity_id) VALUES
           (1, 1, 'ratelimit_clear', 'login:anna:abc'),
           (2, 1, 'ratelimit_clear', 'vote-device:dev'),
           (3, 1, 'ratelimit_clear', 'login'),
           (4, 1, 'settings_update', 'a:b')`,
      ),
      db.prepare(
        `INSERT INTO rate_limits (key, window_start, count) VALUES
           ('login:anna:abc', 0, 1), ('login-ip:abc', 0, 1), ('login-net:abc', 0, 1), ('totp:1', 0, 1)`,
      ),
    ]);

    await db.exec(migration0003);

    expect(await db.prepare("SELECT value FROM kv WHERE key = 'schema_version'").first()).toEqual({ value: '3' });
    expect(await db.prepare('SELECT fp_hash, ip_key FROM devices').first()).toEqual({ fp_hash: null, ip_key: 'ip' });
    expect(await db.prepare('SELECT fp_hash FROM votes').first()).toEqual({ fp_hash: null });
    expect(await db.prepare('SELECT ip_hash, user_agent FROM admin_sessions').first()).toEqual({
      ip_hash: null,
      user_agent: null,
    });
    const audit = await db.prepare('SELECT entity_id FROM audit_log ORDER BY id').all<{ entity_id: string }>();
    expect(audit.results.map((r) => r.entity_id)).toEqual(['login', 'vote-device', 'login', 'a:b']);
    const limits = await db.prepare('SELECT key FROM rate_limits ORDER BY key').all<{ key: string }>();
    expect(limits.results.map((r) => r.key)).toEqual(['login-ip:abc', 'login-net:abc', 'totp:1']);
  });
});
