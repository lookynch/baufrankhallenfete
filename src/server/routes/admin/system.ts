import { Hono } from 'hono';
import { z } from 'zod';
import { settingsSchemas, type SettingsKey } from '../../../shared/settings.ts';
import { body, clientIpHash, fail, idParam, query, type AppEnv } from '../../http.ts';
import { clearRateLimit, peekRateLimit } from '../../security/ratelimit.ts';
import { audit, auditStatement } from '../../services/audit.ts';
import { readBudget } from '../../services/budget.ts';
import { claimPairing, DisplayError, displayKinds } from '../../services/displays.ts';
import { getKv } from '../../services/kv.ts';
import { setCoverage } from '../../services/library.ts';
import {
  accountBalances,
  bookingNo,
  bookManual,
  buckets,
  consumptionStats,
  journal,
  LedgerError,
  reverseEntry,
} from '../../services/ledger.ts';
import { activeEntries, computeSchedule } from '../../services/playback.ts';
import { purgeNow } from '../../services/retention.ts';
import { expectedCloseAt, openRound } from '../../services/rounds.ts';
import { loadSettings, saveSettings, SettingsError } from '../../services/settings.ts';
import { authStatus } from '../../services/spotify-auth.ts';
import { readSnapshot } from '../../services/tick.ts';
import { nowPlayingView, upNextView } from '../../views.ts';
import {
  assertInviteApplicable,
  createInvite,
  INVITE_TTL_MS,
  inviteTarget,
  loginUserKey,
  requireOwner,
  requireReauth,
  revokeInvites,
} from './auth.ts';

export const systemRoutes = new Hono<AppEnv>();

systemRoutes.get('/dashboard', async (c) => {
  const now = c.var.rt.now();
  const db = c.env.DB;
  const settings = await loadSettings(db, now);
  const snapshot = await readSnapshot(db);
  const schedule = computeSchedule(await activeEntries(db), now, snapshot);
  const round = await openRound(db);
  const agents = await db
    .prepare("SELECT key, value, updated_at FROM kv WHERE key LIKE 'agent:%'")
    .all<{ key: string; value: string; updated_at: number }>();
  const displays = await db
    .prepare('SELECT id, name, kind, last_seen_at FROM displays WHERE revoked_at IS NULL ORDER BY name')
    .all();
  const emergencies = await db
    .prepare("SELECT COUNT(*) AS n, MAX(at) AS last_at FROM observed_plays WHERE kind = 'emergency'")
    .first<{ n: number; last_at: number | null }>();
  const counts = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM devices) AS devices,
              (SELECT COUNT(*) FROM wishes WHERE status = 'open') AS open_wishes,
              (SELECT COUNT(*) FROM buzzer_events WHERE flagged = 1) AS flagged_presses,
              (SELECT COUNT(*) FROM votes) AS votes`,
    )
    .first<Record<string, number>>();
  const rows = await buckets(db, settings.event.startsAt - 6 * 3_600_000, now + 60_000);
  return c.json({
    now,
    spotify: await authStatus(c.env),
    snapshot,
    nowPlaying: nowPlayingView(snapshot),
    round: round
      ? { id: round.id, seq: round.seq, level: round.mood_level, expectedCloseAt: expectedCloseAt(round, schedule) }
      : null,
    upNext: upNextView(schedule, 10),
    agents: agents.results.map((a) => ({
      id: a.key.slice(6),
      ...(JSON.parse(a.value) as object),
      updatedAt: a.updated_at,
    })),
    displays: displays.results,
    budget: await readBudget(db),
    ipLimitRejections: await peekRateLimit(db, 'stat:ip_limit_rejections', 86_400, now),
    emergencies,
    counts,
    coverage: await setCoverage(db),
    stats: consumptionStats(rows, settings, now),
    settings: { voting: settings.voting, event: settings.event },
    accessConfigured: Boolean(c.env.ACCESS_AUD && c.env.ACCESS_TEAM_DOMAIN),
    retentionRunAt: (await getKv(db, 'retention_run'))?.updatedAt ?? null,
  });
});

systemRoutes.get('/settings', async (c) => c.json(await loadSettings(c.env.DB, c.var.rt.now())));

systemRoutes.put('/settings/:key', async (c) => {
  const now = c.var.rt.now();
  const key = c.req.param('key');
  if (!(key in settingsSchemas)) fail(404, 'unknown_setting');
  const patch = await body(c, z.record(z.string(), z.unknown()));
  try {
    const change = await saveSettings(c.env.DB, key as SettingsKey, patch, now, c.var.admin.userId);
    await audit(c.env.DB, now, {
      userId: c.var.admin.userId,
      action: 'settings_update',
      entity: 'settings',
      entityId: key,
      ...change,
    });
    return c.json(change.after);
  } catch (error) {
    if (error instanceof SettingsError) fail(422, error.message);
    throw error;
  }
});

systemRoutes.get('/ledger', async (c) => {
  const now = c.var.rt.now();
  const db = c.env.DB;
  const settings = await loadSettings(db, now);
  const accounts = await db.prepare('SELECT code, name, type FROM ledger_accounts ORDER BY code').all();
  const rows = await buckets(db, settings.event.startsAt - 6 * 3_600_000, now + 60_000);
  return c.json({
    journal: await journal(db, 500),
    balances: await accountBalances(db),
    accounts: accounts.results,
    stats: consumptionStats(rows, settings, now),
    settings: settings.ledger,
  });
});

systemRoutes.post('/ledger/entries', async (c) => {
  const now = c.var.rt.now();
  const input = await body(
    c,
    z.object({
      kind: z.enum(['consumption', 'purchase', 'manual']),
      debitAccount: z.string().min(1).max(10),
      creditAccount: z.string().min(1).max(10),
      amountCents: z.number().int().positive().max(100_000_000),
      quantity: z.number().int().min(0).max(1000).default(0),
      text: z.string().trim().min(1).max(200),
      effectiveAt: z.number().int().optional(),
    }),
  );
  try {
    const id = await bookManual(c.env.DB, { ...input, effectiveAt: input.effectiveAt ?? now }, c.var.admin.userId, now);
    await audit(c.env.DB, now, {
      userId: c.var.admin.userId,
      action: 'ledger_book',
      entity: 'ledger_entry',
      entityId: id,
      after: input,
    });
    return c.json({ id, bookingNo: bookingNo(id) });
  } catch (error) {
    if (error instanceof LedgerError) fail(422, error.message);
    throw error;
  }
});

systemRoutes.post('/ledger/entries/:id/reverse', async (c) => {
  const now = c.var.rt.now();
  const id = idParam(c);
  const { reason } = await body(c, z.object({ reason: z.string().trim().min(3).max(150) }));
  try {
    const reversal = await reverseEntry(c.env.DB, id, c.var.admin.userId, now, reason);
    await audit(c.env.DB, now, {
      userId: c.var.admin.userId,
      action: 'ledger_reverse',
      entity: 'ledger_entry',
      entityId: id,
      after: { reversal: bookingNo(reversal), reason },
    });
    return c.json({ id: reversal, bookingNo: bookingNo(reversal) });
  } catch (error) {
    if (error instanceof LedgerError) fail(422, error.message);
    throw error;
  }
});

systemRoutes.put('/ledger/accounts/:code', async (c) => {
  const now = c.var.rt.now();
  const code = c.req.param('code');
  if (!/^[A-Za-z0-9]{1,10}$/.test(code)) fail(400, 'invalid_account');
  const input = await body(
    c,
    z.object({
      name: z.string().trim().min(1).max(80),
      type: z.enum(['asset', 'liability', 'expense', 'income', 'equity']),
    }),
  );
  const before = await c.env.DB.prepare('SELECT * FROM ledger_accounts WHERE code = ?1').bind(code).first();
  await c.env.DB.prepare(
    `INSERT INTO ledger_accounts (code, name, type) VALUES (?1, ?2, ?3)
     ON CONFLICT (code) DO UPDATE SET name = excluded.name, type = excluded.type`,
  )
    .bind(code, input.name, input.type)
    .run();
  await audit(c.env.DB, now, {
    userId: c.var.admin.userId,
    action: 'account_save',
    entity: 'ledger_account',
    entityId: code,
    before,
    after: input,
  });
  return c.json({ ok: true });
});

function csvCell(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const text = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

systemRoutes.get('/ledger/export.csv', async (c) => {
  const entries = (await journal(c.env.DB, 100_000)).reverse();
  const header = [
    'Belegnr',
    'Gebucht',
    'Wirksam',
    'Art',
    'Soll',
    'Haben',
    'Betrag EUR',
    'Kästen',
    'Text',
    'Storno von',
    'Erfasst von',
  ];
  const lines = entries.map((e) =>
    [
      e.booking_no,
      new Date(e.booked_at).toISOString(),
      new Date(e.effective_at).toISOString(),
      e.kind,
      e.debit_account,
      e.credit_account,
      (e.amount_cents / 100).toFixed(2).replace('.', ','),
      e.quantity,
      e.text,
      e.reversal_of ? bookingNo(e.reversal_of) : '',
      e.created_by_name ?? (e.kind === 'consumption' ? 'Buzzer' : ''),
    ]
      .map(csvCell)
      .join(';'),
  );
  return new Response(`\u{FEFF}${[header.join(';'), ...lines].join('\r\n')}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="verbrauchsprotokoll-fete.csv"',
    },
  });
});

systemRoutes.get('/buzzer/events', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT b.event_id, b.agent_id, b.source_code, b.pressed_at, b.received_at, b.flagged, e.id AS entry_id,
            EXISTS (SELECT 1 FROM ledger_entries r WHERE r.reversal_of = e.id) AS reversed
     FROM buzzer_events b LEFT JOIN ledger_entries e ON e.ref_type = 'buzzer' AND e.ref_id = b.event_id
     ORDER BY b.pressed_at DESC LIMIT 300`,
  ).all<{ entry_id: number | null }>();
  return c.json({ events: results.map((e) => ({ ...e, booking_no: e.entry_id ? bookingNo(e.entry_id) : null })) });
});

systemRoutes.get('/displays', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, kind, created_at, last_seen_at, revoked_at FROM displays ORDER BY revoked_at IS NOT NULL, name',
  ).all();
  return c.json({ displays: results });
});

systemRoutes.post('/displays/claim', async (c) => {
  const now = c.var.rt.now();
  const input = await body(
    c,
    z.object({ code: z.string().regex(/^\d{6}$/), name: z.string().trim().min(1).max(40), kind: z.enum(displayKinds) }),
  );
  try {
    const id = await claimPairing(c.env.DB, c.env.ENC_KEY, input, c.var.admin.userId, now);
    await audit(c.env.DB, now, {
      userId: c.var.admin.userId,
      action: 'display_pair',
      entity: 'display',
      entityId: id,
      after: input,
    });
    return c.json({ id });
  } catch (error) {
    if (error instanceof DisplayError) fail(404, error.message);
    throw error;
  }
});

systemRoutes.post('/displays/:id/revoke', async (c) => {
  const now = c.var.rt.now();
  const id = idParam(c);
  await c.env.DB.prepare('UPDATE displays SET revoked_at = ?2 WHERE id = ?1 AND revoked_at IS NULL')
    .bind(id, now)
    .run();
  await audit(c.env.DB, now, { userId: c.var.admin.userId, action: 'display_revoke', entity: 'display', entityId: id });
  return c.json({ ok: true });
});

systemRoutes.get('/audit', async (c) => {
  const { before } = query(c, z.object({ before: z.coerce.number().int().positive().optional() }));
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.at, a.action, a.entity, a.entity_id, a.before_json, a.after_json, u.display_name AS user_name
     FROM audit_log a LEFT JOIN admin_users u ON u.id = a.user_id
     WHERE (?1 IS NULL OR a.id < ?1) ORDER BY a.id DESC LIMIT 100`,
  )
    .bind(before ?? null)
    .all();
  return c.json({ entries: results });
});

systemRoutes.get('/ratelimits', async (c) => {
  const now = c.var.rt.now();
  const db = c.env.DB;
  const { results } = await db
    .prepare(
      "SELECT key, window_start, count FROM rate_limits WHERE window_start > ?1 AND key NOT LIKE 'stat:%' AND key NOT LIKE 'spotify:%' ORDER BY count DESC LIMIT 50",
    )
    .bind(now - 3_600_000)
    .all<{ key: string; window_start: number; count: number }>();
  const users = await db.prepare('SELECT username FROM admin_users').all<{ username: string }>();
  const usernames = new Map(
    await Promise.all(
      users.results.map(async (u) => [await loginUserKey(c.env.IP_HASH_SECRET, u.username), u.username] as const),
    ),
  );
  return c.json({
    limits: results.map((l) => {
      const [kind, subject = ''] = l.key.split(':');
      return { ...l, label: kind === 'login' ? (usernames.get(subject) ?? null) : null };
    }),
  });
});

systemRoutes.post('/ratelimits/clear', async (c) => {
  const { key } = await body(c, z.object({ key: z.string().min(1).max(200) }));
  await clearRateLimit(c.env.DB, key);
  await audit(c.env.DB, c.var.rt.now(), {
    userId: c.var.admin.userId,
    action: 'ratelimit_clear',
    entityId: key.split(':')[0],
  });
  return c.json({ ok: true });
});

systemRoutes.get('/users', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.role, u.disabled, u.created_at, u.last_login_at,
            (SELECT COUNT(*) FROM admin_sessions s WHERE s.user_id = u.id) AS sessions,
            u.password_hash <> '' AS has_password,
            (SELECT COUNT(*) FROM admin_passkeys p WHERE p.user_id = u.id) AS passkeys
     FROM admin_users u ORDER BY u.username`,
  ).all();
  const invites = await c.env.DB.prepare(
    `SELECT username, display_name, role, created_at, expires_at, used_at,
            used_at IS NULL AND expires_at < created_at + ?1 AS revoked
     FROM admin_invites ORDER BY created_at DESC LIMIT 30`,
  )
    .bind(INVITE_TTL_MS)
    .all();
  return c.json({ users: results, invites: invites.results });
});

systemRoutes.post('/sessions/revoke-mine', async (c) => {
  const db = c.env.DB;
  const { userId, sessionHash } = c.var.admin;
  await db.batch([
    db.prepare('DELETE FROM admin_sessions WHERE user_id = ?1 AND token_hash <> ?2').bind(userId, sessionHash),
    auditStatement(db, c.var.rt.now(), {
      userId,
      action: 'sessions_revoke_mine',
      entity: 'admin_user',
      entityId: userId,
      ipHash: await clientIpHash(c),
    }),
  ]);
  return c.json({ ok: true });
});

export const ownerRoutes = new Hono<AppEnv>();
ownerRoutes.use('*', requireOwner);

ownerRoutes.post('/users/invite', async (c) => {
  requireReauth(c);
  const now = c.var.rt.now();
  const input = await body(
    c,
    z.object({
      username: z
        .string()
        .trim()
        .min(3)
        .max(40)
        .regex(/^[a-zA-Z0-9._-]+$/),
      displayName: z.string().trim().min(1).max(60),
      role: z.enum(['owner', 'admin']),
      reset: z.boolean().optional(),
    }),
  );
  const target = await inviteTarget(c.env.DB, input.username);
  if (target && input.reset !== true) fail(409, 'username_exists');
  assertInviteApplicable(target, input.role);
  const token = await createInvite(c.env.DB, input, c.var.admin.userId, now);
  await audit(c.env.DB, now, {
    userId: c.var.admin.userId,
    action: 'user_invite',
    entity: 'admin_user',
    entityId: input.username,
    after: input,
  });
  return c.json({ invitePath: `/admin/invite#${token}` });
});

ownerRoutes.post('/users/invites/revoke', async (c) => {
  requireReauth(c);
  const now = c.var.rt.now();
  const { username } = await body(c, z.object({ username: z.string().trim().min(1).max(40) }));
  const db = c.env.DB;
  const [result] = await db.batch([
    revokeInvites(db, username, now),
    auditStatement(db, now, {
      userId: c.var.admin.userId,
      action: 'invites_revoke',
      entity: 'admin_user',
      entityId: username,
    }),
  ]);
  return c.json({ revoked: result?.meta.changes ?? 0 });
});

ownerRoutes.post('/users/:id/:action{disable|enable}', async (c) => {
  requireReauth(c);
  const now = c.var.rt.now();
  const id = idParam(c);
  const disable = c.req.param('action') === 'disable';
  if (disable && id === c.var.admin.userId) fail(409, 'cannot_disable_self');
  if (disable) {
    const owners = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM admin_users WHERE role = 'owner' AND disabled = 0 AND id <> ?1",
    )
      .bind(id)
      .first<{ n: number }>();
    if ((owners?.n ?? 0) === 0) fail(409, 'last_owner');
  }
  const db = c.env.DB;
  await db.batch([
    db.prepare('UPDATE admin_users SET disabled = ?2 WHERE id = ?1').bind(id, disable ? 1 : 0),
    ...(disable
      ? [
          db.prepare('DELETE FROM admin_sessions WHERE user_id = ?1').bind(id),
          db
            .prepare(
              `UPDATE admin_invites SET expires_at = ?2
               WHERE used_at IS NULL AND expires_at > ?2 AND username = (SELECT username FROM admin_users WHERE id = ?1)`,
            )
            .bind(id, now),
        ]
      : []),
    auditStatement(db, now, {
      userId: c.var.admin.userId,
      action: disable ? 'user_disable' : 'user_enable',
      entity: 'admin_user',
      entityId: id,
    }),
  ]);
  return c.json({ ok: true });
});

ownerRoutes.post('/users/:id/revoke-sessions', async (c) => {
  const id = idParam(c);
  await c.env.DB.prepare('DELETE FROM admin_sessions WHERE user_id = ?1').bind(id).run();
  await audit(c.env.DB, c.var.rt.now(), {
    userId: c.var.admin.userId,
    action: 'user_revoke_sessions',
    entity: 'admin_user',
    entityId: id,
  });
  return c.json({ ok: true });
});

ownerRoutes.post('/cleanup', async (c) => {
  requireReauth(c);
  const now = c.var.rt.now();
  const counts = await purgeNow(c.env.DB, now);
  await audit(c.env.DB, now, { userId: c.var.admin.userId, action: 'event_data_cleanup', after: counts });
  return c.json({ ok: true });
});
