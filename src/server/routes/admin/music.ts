import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { legal } from '../../../shared/legal.ts';
import { moodLevelSchema } from '../../../shared/settings.ts';
import { body, fail, idParam, query, type AppContext, type AppEnv } from '../../http.ts';
import { randomToken, signValue, verifySignedValue } from '../../security/crypto.ts';
import { audit } from '../../services/audit.ts';
import { importTracks, LibraryError, listSets, saveSet, setCoverage, type SongRow } from '../../services/library.ts';
import { activeEntries, computeSchedule } from '../../services/playback.ts';
import { finalizeRound, minCloseAt, openRound, tally, votingActive } from '../../services/rounds.ts';
import { loadSettings } from '../../services/settings.ts';
import { authorizeUrl, authStatus, clearTokens, exchangeCode, spotifyConfigured } from '../../services/spotify-auth.ts';
import { parseSpotifyReference, type SpotifyTrack } from '../../services/spotify-api.ts';
import { readSnapshot, tick } from '../../services/tick.ts';
import { decideWish, wishKey, WishError } from '../../services/wishes.ts';
import { roundView, upNextView } from '../../views.ts';

export const musicRoutes = new Hono<AppEnv>();

const OAUTH_COOKIE = '__Host-oauth';

function redirectUri(c: AppContext): string {
  return `${new URL(c.req.url).origin}/admin/spotify/callback`;
}

function libraryFailure(error: unknown): never {
  if (error instanceof LibraryError || error instanceof WishError) fail(422, error.message);
  throw error;
}

musicRoutes.get('/spotify/status', async (c) => {
  const status = await authStatus(c.env);
  const snapshot = await readSnapshot(c.env.DB);
  return c.json({ ...status, snapshot, redirectUri: redirectUri(c) });
});

musicRoutes.post('/spotify/authorize', async (c) => {
  if (!spotifyConfigured(c.env)) fail(503, 'spotify_not_configured');
  const state = randomToken(24);
  setCookie(c, OAUTH_COOKIE, await signValue(c.env.COOKIE_SECRET, 'oauth', { s: state, u: c.var.admin.userId }), {
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: legal.cookies.oauthMinutes * 60,
  });
  return c.json({ url: authorizeUrl(c.env, redirectUri(c), state) });
});

musicRoutes.post('/spotify/callback', async (c) => {
  const now = c.var.rt.now();
  const input = await body(c, z.object({ code: z.string().min(10).max(1000), state: z.string().min(10).max(100) }));
  const stored = await verifySignedValue<{ s: string; u: number }>(
    c.env.COOKIE_SECRET,
    'oauth',
    getCookie(c, OAUTH_COOKIE),
  );
  deleteCookie(c, OAUTH_COOKIE, { path: '/', secure: true });
  if (!stored || stored.s !== input.state || stored.u !== c.var.admin.userId) fail(403, 'oauth_state_mismatch');
  const tokens = await exchangeCode(c.env, input.code, redirectUri(c), now);
  if (!tokens) fail(502, 'spotify_exchange_failed');
  await audit(c.env.DB, now, {
    userId: c.var.admin.userId,
    action: 'spotify_connected',
    after: { account: tokens.accountName },
  });
  return c.json({ ok: true, accountName: tokens.accountName });
});

musicRoutes.post('/spotify/disconnect', async (c) => {
  await clearTokens(c.env);
  await audit(c.env.DB, c.var.rt.now(), { userId: c.var.admin.userId, action: 'spotify_disconnected' });
  return c.json({ ok: true });
});

musicRoutes.get('/spotify/player', async (c) => {
  const result = await c.var.rt.spotify.player();
  return c.json(result.ok ? { ok: true, ...result.value } : { ok: false, error: result.kind });
});

musicRoutes.post('/spotify/:action{skip|repeat|preshow}', async (c) => {
  const now = c.var.rt.now();
  const action = c.req.param('action');
  const spotify = c.var.rt.spotify;
  let result;
  if (action === 'skip') result = await spotify.skipNext();
  else if (action === 'repeat') result = await spotify.setRepeatContext();
  else {
    const settings = await loadSettings(c.env.DB, now);
    if (!settings.preshow.playlistUri) fail(422, 'preshow_playlist_missing');
    result = await spotify.startContext(settings.preshow.playlistUri);
    if (result.ok) await spotify.setRepeatContext();
  }
  await audit(c.env.DB, now, { userId: c.var.admin.userId, action: `spotify_${action}`, after: { ok: result.ok } });
  return c.json(result.ok ? { ok: true } : { ok: false, error: result.kind });
});

musicRoutes.get('/spotify/playlists', async (c) => {
  const result = await c.var.rt.spotify.myPlaylists();
  if (!result.ok) fail(502, result.kind);
  return c.json({ playlists: result.value });
});

musicRoutes.get('/spotify/search', async (c) => {
  const { q } = query(c, z.object({ q: z.string().min(2).max(100) }));
  const result = await c.var.rt.spotify.search(q);
  if (!result.ok) fail(502, result.kind);
  const uris = result.value.map((t) => t.uri);
  const known = uris.length
    ? await c.env.DB.prepare(
        `SELECT spotify_uri FROM songs WHERE spotify_uri IN (${uris.map((_, i) => `?${i + 1}`).join(', ')})`,
      )
        .bind(...uris)
        .all<{ spotify_uri: string }>()
    : { results: [] };
  const knownSet = new Set(known.results.map((r) => r.spotify_uri));
  return c.json({ tracks: result.value.map((t) => ({ ...t, known: knownSet.has(t.uri) })) });
});

musicRoutes.post('/library/import', async (c) => {
  const now = c.var.rt.now();
  const input = await body(
    c,
    z.object({
      reference: z.string().min(5).max(300),
      setId: z.number().int().positive().nullable(),
      offset: z.number().int().min(0).default(0),
    }),
  );
  const ref = parseSpotifyReference(input.reference);
  if (!ref) fail(422, 'invalid_spotify_reference');
  const spotify = c.var.rt.spotify;
  let tracks: SpotifyTrack[];
  let next: number | null = null;
  let total = 1;
  if (ref.kind === 'track') {
    const result = await spotify.track(ref.id);
    if (!result.ok) fail(422, `spotify_${result.kind}`);
    tracks = [result.value];
  } else {
    const result = await spotify.playlistPage(ref.id, input.offset);
    if (!result.ok) fail(422, `spotify_${result.kind}`);
    tracks = result.value.tracks;
    next = result.value.next;
    total = result.value.total;
  }
  try {
    const { imported } = await importTracks(c.env.DB, tracks, input.setId, now);
    if (input.offset === 0) {
      await audit(c.env.DB, now, {
        userId: c.var.admin.userId,
        action: 'library_import',
        entity: ref.kind,
        entityId: ref.id,
        after: { setId: input.setId, total },
      });
    }
    return c.json({ imported, next, total });
  } catch (error) {
    libraryFailure(error);
  }
});

musicRoutes.get('/songs', async (c) => {
  const input = query(
    c,
    z.object({
      setId: z.coerce.number().int().positive().optional(),
      q: z.string().max(100).optional(),
      level: z.coerce.number().int().min(1).max(5).optional(),
      offset: z.coerce.number().int().min(0).default(0),
    }),
  );
  const conditions: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    conditions.push(sql.replaceAll('?', `?${params.length}`));
  };
  if (input.setId) add('EXISTS (SELECT 1 FROM set_songs x WHERE x.song_id = s.id AND x.set_id = ?)', input.setId);
  if (input.q)
    add("(s.title LIKE ? ESCAPE '\\' OR s.artist LIKE ? ESCAPE '\\')", `%${input.q.replace(/[\\%_]/g, '\\$&')}%`);
  if (input.level) {
    params.push(input.level);
    const p = `?${params.length}`;
    const setLevel = input.setId
      ? `(SELECT default_level FROM sets WHERE id = ${Number(input.setId)})`
      : '(SELECT MIN(st.default_level) FROM set_songs x JOIN sets st ON st.id = x.set_id WHERE x.song_id = s.id)';
    conditions.push(`COALESCE(s.mood_level, ${setLevel}) = ${p}`);
  }
  params.push(input.offset);
  const { results } = await c.env.DB.prepare(
    `SELECT s.*, (SELECT GROUP_CONCAT(x.set_id) FROM set_songs x WHERE x.song_id = s.id) AS set_ids,
            (SELECT p.status FROM playback p WHERE p.song_id = s.id ORDER BY p.seq DESC LIMIT 1) AS playback_status
     FROM songs s ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
     ORDER BY s.artist, s.title LIMIT 100 OFFSET ?${params.length}`,
  )
    .bind(...params)
    .all<SongRow & { set_ids: string | null; playback_status: string | null }>();
  return c.json({
    songs: results.map((s) => ({ ...s, set_ids: s.set_ids ? s.set_ids.split(',').map(Number) : [] })),
  });
});

musicRoutes.patch('/songs/:id', async (c) => {
  const now = c.var.rt.now();
  const id = idParam(c);
  const input = await body(
    c,
    z.object({ mood_level: moodLevelSchema.nullable().optional(), active: z.boolean().optional() }),
  );
  const before = await c.env.DB.prepare('SELECT mood_level, active FROM songs WHERE id = ?1').bind(id).first();
  if (!before) fail(404, 'song_not_found');
  await c.env.DB.prepare(
    `UPDATE songs SET mood_level = CASE WHEN ?2 THEN ?3 ELSE mood_level END, active = COALESCE(?4, active) WHERE id = ?1`,
  )
    .bind(
      id,
      input.mood_level !== undefined ? 1 : 0,
      input.mood_level ?? null,
      input.active === undefined ? null : input.active ? 1 : 0,
    )
    .run();
  await audit(c.env.DB, now, {
    userId: c.var.admin.userId,
    action: 'song_update',
    entity: 'song',
    entityId: id,
    before,
    after: input,
  });
  return c.json({ ok: true });
});

musicRoutes.post('/sets/:setId/songs/:songId/remove', async (c) => {
  const setId = idParam(c, 'setId');
  const songId = idParam(c, 'songId');
  await c.env.DB.prepare('DELETE FROM set_songs WHERE set_id = ?1 AND song_id = ?2').bind(setId, songId).run();
  await audit(c.env.DB, c.var.rt.now(), {
    userId: c.var.admin.userId,
    action: 'set_song_remove',
    entity: 'set',
    entityId: setId,
    before: { songId },
  });
  return c.json({ ok: true });
});

musicRoutes.post('/sets/:setId/songs/:songId/add', async (c) => {
  const setId = idParam(c, 'setId');
  const songId = idParam(c, 'songId');
  await c.env.DB.prepare('INSERT OR IGNORE INTO set_songs (set_id, song_id, added_at) VALUES (?1, ?2, ?3)')
    .bind(setId, songId, c.var.rt.now())
    .run();
  await audit(c.env.DB, c.var.rt.now(), {
    userId: c.var.admin.userId,
    action: 'set_song_add',
    entity: 'set',
    entityId: setId,
    after: { songId },
  });
  return c.json({ ok: true });
});

musicRoutes.get('/sets', async (c) => {
  const settings = await loadSettings(c.env.DB, c.var.rt.now());
  return c.json({ sets: await listSets(c.env.DB), coverage: await setCoverage(c.env.DB, settings.voting) });
});

const setSchema = z.object({
  name: z.string().trim().min(1).max(60),
  starts_at: z.number().int(),
  ends_at: z.number().int(),
  default_level: moodLevelSchema,
});

musicRoutes.post('/sets', async (c) => {
  const now = c.var.rt.now();
  const input = await body(c, setSchema);
  try {
    const id = await saveSet(c.env.DB, input as Parameters<typeof saveSet>[1], now);
    await audit(c.env.DB, now, {
      userId: c.var.admin.userId,
      action: 'set_create',
      entity: 'set',
      entityId: id,
      after: input,
    });
    return c.json({ id });
  } catch (error) {
    libraryFailure(error);
  }
});

musicRoutes.put('/sets/:id', async (c) => {
  const now = c.var.rt.now();
  const id = idParam(c);
  const input = await body(c, setSchema);
  const before = await c.env.DB.prepare('SELECT * FROM sets WHERE id = ?1').bind(id).first();
  if (!before) fail(404, 'set_not_found');
  try {
    await saveSet(c.env.DB, { ...input, id } as Parameters<typeof saveSet>[1], now);
  } catch (error) {
    libraryFailure(error);
  }
  await audit(c.env.DB, now, {
    userId: c.var.admin.userId,
    action: 'set_update',
    entity: 'set',
    entityId: id,
    before,
    after: input,
  });
  return c.json({ ok: true });
});

musicRoutes.post('/sets/:id/delete', async (c) => {
  const now = c.var.rt.now();
  const id = idParam(c);
  const before = await c.env.DB.prepare('SELECT * FROM sets WHERE id = ?1').bind(id).first();
  if (!before) fail(404, 'set_not_found');
  await c.env.DB.prepare('DELETE FROM sets WHERE id = ?1').bind(id).run();
  await audit(c.env.DB, now, { userId: c.var.admin.userId, action: 'set_delete', entity: 'set', entityId: id, before });
  return c.json({ ok: true });
});

musicRoutes.get('/rounds/current', async (c) => {
  const now = c.var.rt.now();
  const db = c.env.DB;
  const schedule = computeSchedule(await activeEntries(db), now, await readSnapshot(db));
  const round = await openRound(db);
  const suspicious = round
    ? await db
        .prepare(
          `SELECT ip_key, COUNT(*) AS devices
           FROM votes WHERE round_id = ?1 AND invalidated = 0 GROUP BY ip_key HAVING COUNT(*) > 1 ORDER BY devices DESC LIMIT 20`,
        )
        .bind(round.id)
        .all<{ ip_key: string; devices: number }>()
    : { results: [] };
  const recent = await db
    .prepare('SELECT id, seq, status, mood_level, opened_at, closed_at FROM rounds ORDER BY seq DESC LIMIT 10')
    .all();
  return c.json({
    round: round ? await roundView(db, round, now, { includeTally: true, schedule }) : null,
    suspicious: suspicious.results.map((s) => ({ ...s, ip_key: s.ip_key.slice(0, 10) })),
    recent: recent.results,
    schedule: upNextView(schedule, 30),
    playing: schedule.find((e) => e.status === 'playing') ?? null,
  });
});

musicRoutes.post('/rounds/:action{close|skip}', async (c) => {
  const rt = c.var.rt;
  const now = rt.now();
  const settings = await loadSettings(c.env.DB, now);
  const round = await openRound(c.env.DB);
  if (!round) fail(409, 'no_open_round');
  const skip = c.req.param('action') === 'skip';
  const earliest = minCloseAt(round);
  if (!skip && now < earliest) {
    await c.env.DB.prepare("UPDATE rounds SET close_at = ?2 WHERE id = ?1 AND status = 'open'")
      .bind(round.id, earliest)
      .run();
    await audit(c.env.DB, now, {
      userId: c.var.admin.userId,
      action: 'round_close_scheduled',
      entity: 'round',
      entityId: round.id,
      after: { closeAt: earliest },
    });
    return c.json({ ok: true, closeAt: earliest });
  }
  const schedule = computeSchedule(await activeEntries(c.env.DB), now, await readSnapshot(c.env.DB));
  const last = schedule[schedule.length - 1];
  const done = await finalizeRound(c.env.DB, settings, round, now, {
    createNext: votingActive(settings, now),
    anchorAt: last && last.scheduledEnd > now ? last.scheduledEnd : now,
    skip,
  });
  if (!done) fail(409, 'round_already_closed');
  await audit(c.env.DB, now, {
    userId: c.var.admin.userId,
    action: skip ? 'round_skip' : 'round_close',
    entity: 'round',
    entityId: round.id,
    after: { tally: await tally(c.env.DB, round.id) },
  });
  rt.waitUntil(tick(rt, { force: true }));
  return c.json({ ok: true });
});

musicRoutes.post('/rounds/:id/invalidate', async (c) => {
  const now = c.var.rt.now();
  const roundId = idParam(c);
  const input = await body(c, z.object({ ipKeyPrefix: z.string().min(6).max(32) }));
  const result = await c.env.DB.prepare(
    'UPDATE votes SET invalidated = 1 WHERE round_id = ?1 AND substr(ip_key, 1, length(?2)) = ?2 AND invalidated = 0',
  )
    .bind(roundId, input.ipKeyPrefix)
    .run();
  await audit(c.env.DB, now, {
    userId: c.var.admin.userId,
    action: 'votes_invalidate',
    entity: 'round',
    entityId: roundId,
    after: { ipKeyPrefix: input.ipKeyPrefix, count: result.meta.changes },
  });
  return c.json({ invalidated: result.meta.changes });
});

musicRoutes.post('/playback/:id/cancel', async (c) => {
  const now = c.var.rt.now();
  const id = idParam(c);
  const result = await c.env.DB.prepare("UPDATE playback SET status = 'cancelled' WHERE id = ?1 AND status = 'planned'")
    .bind(id)
    .run();
  if (result.meta.changes !== 1) fail(409, 'entry_not_cancellable');
  await audit(c.env.DB, now, {
    userId: c.var.admin.userId,
    action: 'playback_cancel',
    entity: 'playback',
    entityId: id,
  });
  return c.json({ ok: true });
});

musicRoutes.post('/playback/:id/move', async (c) => {
  const now = c.var.rt.now();
  const id = idParam(c);
  const { direction } = await body(c, z.object({ direction: z.enum(['up', 'down']) }));
  const db = c.env.DB;
  const entry = await db
    .prepare("SELECT id, seq FROM playback WHERE id = ?1 AND status = 'planned'")
    .bind(id)
    .first<{ id: number; seq: number }>();
  if (!entry) fail(409, 'entry_not_movable');
  const neighbor = await db
    .prepare(
      direction === 'up'
        ? "SELECT id, seq FROM playback WHERE seq < ?1 AND status = 'planned' ORDER BY seq DESC LIMIT 1"
        : "SELECT id, seq FROM playback WHERE seq > ?1 AND status = 'planned' ORDER BY seq ASC LIMIT 1",
    )
    .bind(entry.seq)
    .first<{ id: number; seq: number }>();
  if (!neighbor) fail(409, 'no_neighbor');
  await db.batch([
    db.prepare('UPDATE playback SET seq = -seq WHERE id = ?1').bind(entry.id),
    db.prepare('UPDATE playback SET seq = ?2 WHERE id = ?1').bind(neighbor.id, entry.seq),
    db.prepare('UPDATE playback SET seq = ?2 WHERE id = ?1').bind(entry.id, neighbor.seq),
  ]);
  await audit(c.env.DB, now, {
    userId: c.var.admin.userId,
    action: 'playback_move',
    entity: 'playback',
    entityId: id,
    after: { direction },
  });
  return c.json({ ok: true });
});

musicRoutes.post('/playback/insert', async (c) => {
  const now = c.var.rt.now();
  const { songId } = await body(c, z.object({ songId: z.number().int().positive() }));
  const db = c.env.DB;
  const existing = await db
    .prepare(
      `SELECT
         EXISTS (SELECT 1 FROM songs WHERE id = ?1) AS known,
         EXISTS (
           SELECT 1 FROM playback WHERE song_id = ?1 AND status IN ('planned', 'queuing', 'queued', 'unknown', 'playing')
         ) AS scheduled,
         EXISTS (
           SELECT 1 FROM round_candidates c JOIN rounds r ON r.id = c.round_id WHERE r.status = 'open' AND c.song_id = ?1
         ) AS candidate`,
    )
    .bind(songId)
    .first<{ known: number; scheduled: number; candidate: number }>();
  if (!existing?.known) fail(404, 'song_not_found');
  if (existing.scheduled) fail(409, 'song_already_scheduled');
  if (existing.candidate) fail(409, 'song_is_round_candidate');
  const anchor = await db
    .prepare(
      `SELECT seq FROM playback WHERE status IN ('queuing', 'queued', 'unknown', 'playing') ORDER BY seq DESC LIMIT 1`,
    )
    .first<{ seq: number }>();
  const base =
    anchor?.seq ??
    (await db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM playback').first<{ seq: number }>())?.seq ??
    0;
  const free = await db
    .prepare(
      `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 9)
       SELECT ?1 + x AS seq FROM n WHERE NOT EXISTS (SELECT 1 FROM playback WHERE seq = ?1 + x) ORDER BY x LIMIT 1`,
    )
    .bind(base)
    .first<{ seq: number }>();
  if (!free) fail(409, 'no_slot_available');
  const round = await db
    .prepare('SELECT round_id FROM playback WHERE seq = ?1')
    .bind(base)
    .first<{ round_id: number | null }>();
  await db
    .prepare(
      `INSERT INTO playback (seq, round_id, song_id, source, position, status, created_at) VALUES (?1, ?2, ?3, 'manual', 0, 'planned', ?4)`,
    )
    .bind(free.seq, round?.round_id ?? null, songId, now)
    .run();
  await audit(c.env.DB, now, {
    userId: c.var.admin.userId,
    action: 'playback_insert',
    entity: 'song',
    entityId: songId,
  });
  return c.json({ ok: true });
});

musicRoutes.get('/wishes', async (c) => {
  const { status } = query(c, z.object({ status: z.enum(['open', 'approved', 'rejected', 'played']).default('open') }));
  const { results } = await c.env.DB.prepare(
    `SELECT w.id, w.status, w.created_at, w.decided_at, s.id AS song_id, s.title, s.artist, s.image_url, s.explicit, s.mood_level,
            (SELECT COUNT(*) FROM wish_upvotes u WHERE u.wish_id = w.id) AS upvotes,
            u2.display_name AS decided_by_name
     FROM wishes w JOIN songs s ON s.id = w.song_id LEFT JOIN admin_users u2 ON u2.id = w.decided_by
     WHERE w.status = ?1 ORDER BY w.created_at DESC LIMIT 200`,
  )
    .bind(status)
    .all<{ id: number }>();
  return c.json({ wishes: results.map((w) => ({ ...w, key: wishKey(w.id) })) });
});

musicRoutes.post('/wishes/:id/decide', async (c) => {
  const now = c.var.rt.now();
  const id = idParam(c);
  const input = await body(
    c,
    z.discriminatedUnion('approve', [
      z.object({ approve: z.literal(true), setId: z.number().int().positive(), level: moodLevelSchema.nullable() }),
      z.object({ approve: z.literal(false) }),
    ]),
  );
  try {
    const change = await decideWish(c.env.DB, id, input, c.var.admin.userId, now);
    await audit(c.env.DB, now, {
      userId: c.var.admin.userId,
      action: input.approve ? 'wish_approve' : 'wish_reject',
      entity: 'wish',
      entityId: id,
      ...change,
    });
    return c.json({ ok: true });
  } catch (error) {
    libraryFailure(error);
  }
});

musicRoutes.get('/spotify/preshow-check', async (c) => {
  const settings = await loadSettings(c.env.DB, c.var.rt.now());
  const uri = settings.preshow.playlistUri;
  if (!uri) return c.json({ checked: 0, overlaps: [] });
  const id = uri.split(':')[2]!;
  const tracks: SpotifyTrack[] = [];
  for (let offset = 0, page = 0; page < 4; page++) {
    const result = await c.var.rt.spotify.playlistPage(id, offset);
    if (!result.ok) fail(422, `spotify_${result.kind}`);
    tracks.push(...result.value.tracks);
    if (result.value.next === null) break;
    offset = result.value.next;
  }
  const overlaps: Array<{ title: string; artist: string }> = [];
  for (let i = 0; i < tracks.length; i += 40) {
    const rows = tracks.slice(i, i + 40);
    const params = rows.flatMap((t) => [t.uri, t.isrc ?? '']);
    const placeholders = rows.map((_, r) => `(?${r * 2 + 1}, ?${r * 2 + 2})`).join(', ');
    const { results } = await c.env.DB.prepare(
      `SELECT DISTINCT s.title, s.artist FROM songs s JOIN set_songs ss ON ss.song_id = s.id
       JOIN (VALUES ${placeholders}) AS v ON s.spotify_uri = v.column1 OR (v.column2 <> '' AND s.isrc = v.column2)`,
    )
      .bind(...params)
      .all<{ title: string; artist: string }>();
    overlaps.push(...results);
  }
  return c.json({ checked: tracks.length, overlaps: overlaps.slice(0, 50) });
});
