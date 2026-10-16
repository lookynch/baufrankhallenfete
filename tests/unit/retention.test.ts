import { describe, expect, it } from 'vitest';
import {
  forgetDeviceStatements,
  purgeNow,
  RETENTION_SQL,
  retentionStatements,
} from '../../src/server/services/retention.ts';
import { createTestDb } from '../helpers/d1.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

async function rows<T = Record<string, unknown>>(db: D1Database, sql: string): Promise<T[]> {
  return (await db.prepare(sql).all<T>()).results;
}

function insertSongs(db: D1Database) {
  return db.prepare(
    `INSERT INTO songs (id, spotify_uri, title, artist, duration_ms, title_norm, artist_norm, created_at) VALUES
       (1, 'spotify:track:a', 'A', 'X', 1000, 'a', 'x', 0), (2, 'spotify:track:b', 'B', 'X', 1000, 'b', 'x', 0)`,
  );
}

async function seed(db: D1Database, now: number) {
  const ago = (ms: number) => now - ms;
  await db.batch([
    insertSongs(db),
    db
      .prepare(
        "INSERT INTO rounds (id, seq, status, mood_level, opened_at) VALUES (1, 1, 'closed', 2, ?1), (2, 2, 'open', 2, ?2)",
      )
      .bind(ago(8 * DAY), ago(HOUR)),
    db
      .prepare(
        `INSERT INTO devices (id, created_at, ip_key, last_seen_at) VALUES
           ('alt', ?1, 'ip-alt', ?1), ('neu', ?2, 'ip-neu', ?2), ('grenze', ?3, 'ip-grenze', ?3)`,
      )
      .bind(ago(8 * DAY), ago(HOUR), ago(7 * DAY - MIN)),
    db
      .prepare(
        `INSERT INTO votes (round_id, device_id, ip_key, song_id, created_at, updated_at) VALUES
           (1, 'alt', 'ip-alt', 1, ?1, ?1), (2, 'neu', 'ip-neu', 2, ?2, ?2)`,
      )
      .bind(ago(8 * DAY), ago(HOUR)),
    db
      .prepare(
        `INSERT INTO wishes (id, song_id, device_id, status, created_at) VALUES
           (1, 1, 'alt', 'played', ?1), (2, 2, 'neu', 'open', ?2)`,
      )
      .bind(ago(8 * DAY), ago(HOUR)),
    db
      .prepare(
        `INSERT INTO wish_upvotes (wish_id, device_id, ip_key, created_at) VALUES
           (1, 'alt', 'ip-alt', ?1), (2, 'neu', 'ip-neu', ?2)`,
      )
      .bind(ago(8 * DAY), ago(HOUR)),
    db
      .prepare(
        `INSERT INTO rate_limits (key, window_start, count) VALUES
           ('vote-device:alt', ?1, 3), ('login-ip:abc', ?2, 5), ('stat:ip_limit_rejections', ?3, 2)`,
      )
      .bind(ago(DAY + HOUR), Math.floor(now / (15 * MIN)) * 15 * MIN, ago(23 * HOUR)),
    db
      .prepare("INSERT INTO search_cache (query, results, fetched_at) VALUES ('alt', '[]', ?1), ('neu', '[]', ?2)")
      .bind(ago(DAY + HOUR), ago(HOUR)),
    db
      .prepare(
        `INSERT INTO audit_log (id, at, user_id, action, after_json, ip_hash) VALUES
           (1, ?1, 1, 'sessions_revoke_mine', NULL, 'hash-alt'),
           (2, ?2, 1, 'sessions_revoke_mine', NULL, 'hash-neu'),
           (3, ?1, 1, 'votes_invalidate', '{"ipKeyPrefix":"abcdef","count":2}', NULL),
           (4, ?2, 1, 'votes_invalidate', '{"ipKeyPrefix":"123456","count":1}', NULL),
           (5, ?3, 1, 'settings_update', NULL, NULL),
           (6, ?4, 1, 'settings_update', NULL, NULL)`,
      )
      .bind(ago(8 * DAY), ago(DAY), ago(91 * DAY), ago(89 * DAY)),
    db
      .prepare(
        `INSERT INTO admin_users (id, username, display_name, role, password_hash, totp_secret_enc, disabled, created_at, last_login_at) VALUES
           (1, 'anna', 'Anna', 'owner', 'x', 'x', 0, ?1, ?1),
           (2, 'alt', 'Alt', 'admin', 'x', 'x', 1, ?1, ?2),
           (3, 'pause', 'Pause', 'admin', 'x', 'x', 1, ?1, ?3),
           (4, 'nie', 'Nie', 'admin', 'x', 'x', 1, ?2, NULL)`,
      )
      .bind(ago(200 * DAY), ago(91 * DAY), ago(10 * DAY)),
    db.prepare("INSERT INTO admin_recovery_codes (user_id, code_hash) VALUES (1, 'r1'), (2, 'r2')"),
    db.prepare(
      `INSERT INTO admin_passkeys (credential_id, user_id, public_key, name, created_at) VALUES
         ('pk-anna', 1, '{}', 'iPhone', 0), ('pk-alt', 2, '{}', 'iPhone', 0)`,
    ),
    db
      .prepare(
        `INSERT INTO webauthn_challenges (challenge_hash, purpose, expires_at) VALUES
           ('offen', 'login', ?1), ('abgelaufen', 'login', ?2)`,
      )
      .bind(now + MIN, ago(MIN)),
    db
      .prepare(
        `INSERT INTO admin_sessions (token_hash, user_id, created_at, last_seen_at, expires_at, reauth_at) VALUES
           ('aktiv', 1, ?1, ?2, ?3, ?1), ('abgelaufen', 1, ?1, ?2, ?4, ?1), ('idle', 1, ?1, ?5, ?3, ?1)`,
      )
      .bind(ago(HOUR), ago(10 * MIN), now + 10 * HOUR, ago(MIN), ago(2 * HOUR + MIN)),
    db
      .prepare(
        `INSERT INTO admin_invites (token_hash, username, display_name, role, created_at, expires_at) VALUES
           ('alt', 'alt', 'Alt', 'admin', ?1, ?1), ('jung', 'jung', 'Jung', 'admin', ?2, ?2)`,
      )
      .bind(ago(91 * DAY), ago(89 * DAY)),
  ]);
}

async function retained() {
  const db = createTestDb();
  await seed(db, Date.now());
  await db.exec(RETENTION_SQL);
  return db;
}

describe('Tägliche Löschfristen (RETENTION_SQL)', () => {
  it('löscht oder anonymisiert Gästedaten zeilenweise nach 7 Tagen, frische Zeilen anderer Geräte schützen nichts', async () => {
    const db = await retained();
    expect(await rows(db, 'SELECT id FROM devices ORDER BY id')).toEqual([{ id: 'grenze' }, { id: 'neu' }]);
    expect(await rows(db, 'SELECT round_id, device_id FROM votes')).toEqual([{ round_id: 2, device_id: 'neu' }]);
    expect(await rows(db, 'SELECT id, device_id FROM wishes ORDER BY id')).toEqual([
      { id: 1, device_id: 'anon' },
      { id: 2, device_id: 'neu' },
    ]);
    const upvotes = await rows<{ wish_id: number; device_id: string; ip_key: string | null }>(
      db,
      'SELECT wish_id, device_id, ip_key FROM wish_upvotes ORDER BY wish_id',
    );
    expect(upvotes[0]).toEqual({ wish_id: 1, device_id: expect.stringMatching(/^anon-\d+$/), ip_key: null });
    expect(upvotes[1]).toEqual({ wish_id: 2, device_id: 'neu', ip_key: 'ip-neu' });
  });

  it('löscht Suchcache und Rate-Limits nach 24 h, aktive Sperren bleiben', async () => {
    const db = await retained();
    expect(await rows(db, 'SELECT key FROM rate_limits ORDER BY key')).toEqual([
      { key: 'login-ip:abc' },
      { key: 'stat:ip_limit_rejections' },
    ]);
    expect(await rows(db, 'SELECT query FROM search_cache')).toEqual([{ query: 'neu' }]);
  });

  it('entfernt IP-Bezüge im Audit nach 7 Tagen und Einträge nach 90 Tagen', async () => {
    const db = await retained();
    expect(await rows(db, 'SELECT id, after_json, ip_hash FROM audit_log ORDER BY id')).toEqual([
      { id: 1, after_json: null, ip_hash: null },
      { id: 2, after_json: null, ip_hash: 'hash-neu' },
      { id: 3, after_json: '{"count":2}', ip_hash: null },
      { id: 4, after_json: '{"ipKeyPrefix":"123456","count":1}', ip_hash: null },
      { id: 6, after_json: null, ip_hash: null },
    ]);
  });

  it('löscht abgelaufene Sessions, Challenges, alte Einladungen und deaktivierte Konten samt Zugängen', async () => {
    const db = await retained();
    expect(await rows(db, 'SELECT token_hash FROM admin_sessions')).toEqual([{ token_hash: 'aktiv' }]);
    expect(await rows(db, 'SELECT token_hash FROM admin_invites')).toEqual([{ token_hash: 'jung' }]);
    expect(await rows(db, 'SELECT username FROM admin_users ORDER BY id')).toEqual([
      { username: 'anna' },
      { username: 'pause' },
    ]);
    expect(await rows(db, 'SELECT user_id FROM admin_recovery_codes')).toEqual([{ user_id: 1 }]);
    expect(await rows(db, 'SELECT credential_id FROM admin_passkeys')).toEqual([{ credential_id: 'pk-anna' }]);
    expect(await rows(db, 'SELECT challenge_hash FROM webauthn_challenges')).toEqual([{ challenge_hash: 'offen' }]);
  });

  it('setzt den Laufnachweis und ist idempotent', async () => {
    const before = Date.now();
    const db = await retained();
    const tables = ['devices', 'votes', 'wishes', 'wish_upvotes', 'rate_limits', 'search_cache', 'audit_log'];
    const snapshot = async () => Promise.all(tables.map((t) => rows(db, `SELECT * FROM ${t} ORDER BY rowid`)));
    const first = await snapshot();
    await db.exec(RETENTION_SQL);
    expect(await snapshot()).toEqual(first);
    const run = await db
      .prepare("SELECT value, updated_at FROM kv WHERE key = 'retention_run'")
      .first<{ value: string; updated_at: number }>();
    expect(run?.value).toBe('true');
    expect(run?.updated_at).toBeGreaterThanOrEqual(before - 1000);
    expect(run?.updated_at).toBeLessThanOrEqual(Date.now());
  });
});

describe('Sofort-Löschung (purgeNow)', () => {
  it('bindet jedes Statement an den Zeitpunkt', () => {
    expect(retentionStatements('?1', true).every((sql) => sql.includes('?1'))).toBe(true);
  });

  it('löscht alle Gästedaten, die eigene Session bleibt', async () => {
    const db = createTestDb();
    const now = Date.now();
    await seed(db, now);
    expect(await purgeNow(db, now)).toEqual({ votes: 2, devices: 3 });
    for (const table of ['votes', 'devices', 'rate_limits', 'search_cache']) {
      expect(await rows(db, `SELECT * FROM ${table}`)).toEqual([]);
    }
    expect(await rows(db, "SELECT id FROM wishes WHERE device_id <> 'anon'")).toEqual([]);
    expect(
      await rows(db, "SELECT wish_id FROM wish_upvotes WHERE ip_key IS NOT NULL OR device_id NOT LIKE 'anon-%'"),
    ).toEqual([]);
    expect(
      await rows(db, "SELECT id FROM audit_log WHERE ip_hash IS NOT NULL OR after_json LIKE '%ipKeyPrefix%'"),
    ).toEqual([]);
    expect(await rows(db, 'SELECT token_hash FROM admin_sessions')).toEqual([{ token_hash: 'aktiv' }]);
    expect(await rows(db, "SELECT updated_at FROM kv WHERE key = 'retention_run'")).toEqual([{ updated_at: now }]);
  });
});

describe('Gast-Löschung (forgetDeviceStatements)', () => {
  it('betrifft nur das eigene Gerät, auch wenn die ID einen Unterstrich enthält', async () => {
    const db = createTestDb();
    const now = Date.now();
    await db.batch([
      insertSongs(db),
      db.prepare("INSERT INTO rounds (id, seq, status, mood_level, opened_at) VALUES (1, 1, 'open', 2, ?1)").bind(now),
      db
        .prepare(
          "INSERT INTO devices (id, created_at, ip_key, last_seen_at) VALUES ('a_c', ?1, 'ip', ?1), ('abc', ?1, 'ip', ?1)",
        )
        .bind(now),
      db
        .prepare(
          "INSERT INTO votes (round_id, device_id, ip_key, song_id, created_at, updated_at) VALUES (1, 'a_c', 'ip', 1, ?1, ?1), (1, 'abc', 'ip', 2, ?1, ?1)",
        )
        .bind(now),
      db
        .prepare(
          "INSERT INTO wishes (id, song_id, device_id, status, created_at) VALUES (1, 1, 'a_c', 'open', ?1), (2, 2, 'abc', 'open', ?1)",
        )
        .bind(now),
      db
        .prepare(
          "INSERT INTO wish_upvotes (wish_id, device_id, ip_key, created_at) VALUES (2, 'a_c', 'ip', ?1), (1, 'abc', 'ip', ?1)",
        )
        .bind(now),
      db
        .prepare(
          `INSERT INTO rate_limits (key, window_start, count) VALUES
             ('vote-device:a_c', ?1, 1), ('wish-device:a_c', ?1, 1), ('vote-device:abc', ?1, 1), ('vote-device:xa_c', ?1, 1)`,
        )
        .bind(now),
    ]);

    await db.batch(forgetDeviceStatements(db, 'a_c'));

    expect(await rows(db, 'SELECT id FROM devices')).toEqual([{ id: 'abc' }]);
    expect(await rows(db, 'SELECT device_id FROM votes')).toEqual([{ device_id: 'abc' }]);
    expect(await rows(db, 'SELECT id, device_id FROM wishes ORDER BY id')).toEqual([
      { id: 1, device_id: 'anon' },
      { id: 2, device_id: 'abc' },
    ]);
    expect(await rows(db, 'SELECT wish_id, device_id, ip_key FROM wish_upvotes ORDER BY wish_id')).toEqual([
      { wish_id: 1, device_id: 'abc', ip_key: 'ip' },
    ]);
    expect(await rows(db, 'SELECT key FROM rate_limits ORDER BY key')).toEqual([
      { key: 'vote-device:abc' },
      { key: 'vote-device:xa_c' },
    ]);
  });
});
