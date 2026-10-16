import type { Settings } from '../../shared/settings.ts';
import { trackIdFromUri } from '../../shared/spotify.ts';
import { hitRateLimit } from '../security/ratelimit.ts';
import {
  blockedTermSet,
  classify,
  loadArtistTags,
  NEW_ARTISTS_PER_SEARCH,
  verdictFor,
  type ArtistTag,
  type Lastfm,
  type TrackVerdict,
} from './genres.ts';
import { ensureSong, listSets, normalizeTitle, setActiveAt, setExists } from './library.ts';
import type { SpotifyApi, SpotifyTrack } from './spotify-api.ts';

export class WishError extends Error {}

const SEARCH_CACHE_MS = 15 * 60_000;
const GLOBAL_SEARCH_LIMIT = 10;
const GLOBAL_SEARCH_WINDOW_S = 30;
const GLOBAL_TRACK_LIMIT = 10;
const GLOBAL_TRACK_WINDOW_S = 30;
const MINUTE = 60_000;

export interface WishContext {
  spotify: SpotifyApi;
  lastfm: Lastfm | null;
  settings: Settings;
}

export interface UpvoteNetwork {
  ipKey: string;
  limit: number;
}

export function wishKey(id: number): string {
  return `FETE-${id}`;
}

export function normalizeQuery(query: string): string {
  return normalizeTitle(query).slice(0, 60);
}

interface KnownSong {
  spotify_uri: string;
  vetoed: number;
  admin_listed: number;
}

async function knownSongs(db: D1Database, uris: string[]): Promise<Map<string, KnownSong>> {
  if (uris.length === 0) return new Map();
  const { results } = await db
    .prepare(
      `SELECT s.spotify_uri, s.vetoed,
              EXISTS (SELECT 1 FROM set_songs x WHERE x.song_id = s.id AND x.source = 'admin') AS admin_listed
       FROM songs s WHERE s.spotify_uri IN (${uris.map((_, i) => `?${i + 1}`).join(', ')})`,
    )
    .bind(...uris)
    .all<KnownSong>();
  return new Map(results.map((r) => [r.spotify_uri, r]));
}

async function verdicts(
  db: D1Database,
  ctx: WishContext,
  tracks: SpotifyTrack[],
  now: number,
  maxFetch: number,
): Promise<TrackVerdict[]> {
  if (!ctx.lastfm) return tracks.map(() => ({ kind: 'allowed', level: null }));
  const tags = await loadArtistTags(
    db,
    ctx.lastfm,
    tracks.flatMap((t) => t.artists.slice(0, 1)),
    now,
    maxFetch,
  );
  const blocked = blockedTermSet(ctx.settings.filter.blockedTags);
  return tracks.map((t) => verdictFor(t.artists[0], tags, blocked));
}

async function partyFilter(
  db: D1Database,
  ctx: WishContext,
  tracks: SpotifyTrack[],
  now: number,
): Promise<{ tracks: SpotifyTrack[]; hidden: number }> {
  const known = await knownSongs(
    db,
    tracks.map((t) => t.uri),
  );
  const open = tracks.filter((t) => !known.get(t.uri)?.vetoed);
  const unchecked = open.filter((t) => !known.get(t.uri)?.admin_listed);
  const results = await verdicts(db, ctx, unchecked, now, NEW_ARTISTS_PER_SEARCH);
  const blocked = new Set(unchecked.filter((_, i) => results[i]!.kind === 'blocked').map((t) => t.uri));
  const visible = open.filter((t) => !blocked.has(t.uri));
  return { tracks: visible, hidden: tracks.length - visible.length };
}

function parseCached(results: string): SpotifyTrack[] {
  return (JSON.parse(results) as SpotifyTrack[]).map((t) => ({ ...t, artists: t.artists ?? [] }));
}

export async function searchTracks(
  db: D1Database,
  ctx: WishContext,
  query: string,
  now: number,
): Promise<{ tracks: SpotifyTrack[]; hidden: number; limited: boolean; unavailable: boolean }> {
  const raw = await rawSearch(db, ctx.spotify, query, now);
  if (raw.tracks.length === 0) return { ...raw, hidden: 0 };
  return { ...raw, ...(await partyFilter(db, ctx, raw.tracks, now)) };
}

async function rawSearch(
  db: D1Database,
  spotify: SpotifyApi,
  query: string,
  now: number,
): Promise<{ tracks: SpotifyTrack[]; limited: boolean; unavailable: boolean }> {
  const normalized = normalizeQuery(query);
  if (normalized.length < 3) return { tracks: [], limited: false, unavailable: false };
  const cached = await db
    .prepare('SELECT results, fetched_at FROM search_cache WHERE query = ?1')
    .bind(normalized)
    .first<{ results: string; fetched_at: number }>();
  if (cached && now - cached.fetched_at < SEARCH_CACHE_MS) {
    return { tracks: parseCached(cached.results), limited: false, unavailable: false };
  }
  const budget = await hitRateLimit(db, 'spotify:search', GLOBAL_SEARCH_LIMIT, GLOBAL_SEARCH_WINDOW_S, now);
  if (!budget.allowed) {
    return {
      tracks: cached ? parseCached(cached.results) : [],
      limited: !cached,
      unavailable: false,
    };
  }
  const result = await spotify.search(query.slice(0, 100));
  if (!result.ok) {
    const rateLimited = result.kind === 'rate_limited';
    return {
      tracks: cached ? parseCached(cached.results) : [],
      limited: !cached && rateLimited,
      unavailable: !cached && !rateLimited,
    };
  }
  await db
    .prepare(
      `INSERT INTO search_cache (query, results, fetched_at) VALUES (?1, ?2, ?3)
       ON CONFLICT (query) DO UPDATE SET results = excluded.results, fetched_at = excluded.fetched_at`,
    )
    .bind(normalized, JSON.stringify(result.value), now)
    .run();
  return { tracks: result.value, limited: false, unavailable: false };
}

async function trackFromCache(db: D1Database, uri: string): Promise<SpotifyTrack | null> {
  const { results } = await db
    .prepare('SELECT results FROM search_cache WHERE results LIKE ?1 ORDER BY fetched_at DESC LIMIT 5')
    .bind(`%${uri}%`)
    .all<{ results: string }>();
  for (const row of results) {
    const match = parseCached(row.results).find((t) => t.uri === uri);
    if (match) return match;
  }
  return null;
}

async function lookupTrack(db: D1Database, spotify: SpotifyApi, trackId: string, uri: string, now: number) {
  const cached = await trackFromCache(db, uri);
  if (cached) return cached;
  const budget = await hitRateLimit(db, 'spotify:track', GLOBAL_TRACK_LIMIT, GLOBAL_TRACK_WINDOW_S, now);
  if (!budget.allowed) throw new WishError('limited');
  const fetched = await spotify.track(trackId);
  if (!fetched.ok) throw new WishError('track_unavailable');
  return fetched.value;
}

async function wishTargetSet(db: D1Database, settings: Settings, now: number): Promise<number | null> {
  const playAt = now + settings.voting.minRoundMinutes * MINUTE + 2 * MINUTE;
  return setActiveAt(await listSets(db), playAt)?.id ?? null;
}

function wishSetSongStatement(
  db: D1Database,
  setId: number,
  songId: number,
  wishMatch: { sql: string; value: string | number },
  now: number,
) {
  return db
    .prepare(
      `INSERT OR IGNORE INTO set_songs (set_id, song_id, added_at, source)
       SELECT ?1, ?2, ?4, 'wish'
       WHERE EXISTS (
         SELECT 1 FROM wishes WHERE ${wishMatch.sql} AND song_id = ?2 AND status = 'approved' AND decided_at = ?4
       )`,
    )
    .bind(setId, songId, wishMatch.value, now);
}

export async function createWish(
  db: D1Database,
  ctx: WishContext,
  deviceId: string,
  uri: string,
  now: number,
  network?: UpvoteNetwork,
): Promise<{ id: number; key: string; status: string; merged: boolean }> {
  const trackId = trackIdFromUri(uri);
  if (!trackId) throw new WishError('invalid_track');
  const track = await lookupTrack(db, ctx.spotify, trackId, uri, now);
  if (track.explicit && !ctx.settings.voting.allowExplicit) throw new WishError('explicit_not_allowed');

  const known = (await knownSongs(db, [track.uri])).get(track.uri);
  if (known?.vetoed) throw new WishError('vetoed');
  let autoLevel: number | null = null;
  if (!known?.admin_listed) {
    const [verdict] = await verdicts(db, ctx, [track], now, 1);
    if (verdict?.kind === 'blocked') throw new WishError('not_party_fit');
    if (verdict?.kind === 'unknown') throw new WishError('classification_unavailable');
    autoLevel = verdict?.kind === 'allowed' ? verdict.level : null;
  }

  const song = await ensureSong(db, track, now, autoLevel);
  if (song.vetoed) throw new WishError('vetoed');
  const scheduled = await db
    .prepare(
      `SELECT MAX(status IN ('played', 'skipped')) AS done FROM playback
       WHERE song_id = ?1 AND status NOT IN ('missed', 'cancelled')`,
    )
    .bind(song.id)
    .first<{ done: number | null }>();
  if (scheduled?.done === 1) throw new WishError('already_played');
  if (scheduled?.done === 0) throw new WishError('already_scheduled');

  const setId = ctx.settings.wishes.autoApprove ? await wishTargetSet(db, ctx.settings, now) : null;
  const status = setId === null ? 'open' : 'approved';
  const statements = [
    db
      .prepare(
        `INSERT INTO wishes (song_id, device_id, status, created_at, decided_at)
         SELECT ?1, ?2, ?4, ?3, CASE WHEN ?4 = 'approved' THEN ?3 END
         WHERE NOT EXISTS (SELECT 1 FROM wishes WHERE song_id = ?1 AND status IN ('open', 'approved'))
         ON CONFLICT DO NOTHING RETURNING id, status`,
      )
      .bind(song.id, deviceId, now, status),
  ];
  if (setId !== null) {
    statements.push(
      wishSetSongStatement(db, setId, song.id, { sql: 'device_id = ?3 AND created_at = ?4', value: deviceId }, now),
    );
  }
  const [result] = await db.batch<{ id: number; status: string }>(statements);
  const inserted = result?.results[0];
  if (inserted) return { id: inserted.id, key: wishKey(inserted.id), status: inserted.status, merged: false };

  const existing = await db
    .prepare("SELECT id, status FROM wishes WHERE song_id = ?1 AND status IN ('open', 'approved')")
    .bind(song.id)
    .first<{ id: number; status: string }>();
  if (!existing) throw new WishError('wish_conflict');
  let mergedStatus = existing.status;
  if (existing.status === 'open' && setId !== null) {
    const [approved] = await db.batch([
      db
        .prepare(
          "UPDATE wishes SET status = 'approved', decided_at = ?2, decided_by = NULL WHERE id = ?1 AND status = 'open'",
        )
        .bind(existing.id, now),
      wishSetSongStatement(db, setId, song.id, { sql: 'id = ?3', value: existing.id }, now),
    ]);
    if (approved?.meta.changes === 1) mergedStatus = 'approved';
  }
  await insertUpvote(db, existing.id, deviceId, now, network, true);
  return { id: existing.id, key: wishKey(existing.id), status: mergedStatus, merged: true };
}

async function insertUpvote(
  db: D1Database,
  wishId: number,
  deviceId: string,
  now: number,
  network: UpvoteNetwork | undefined,
  allowOpen: boolean,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO wish_upvotes (wish_id, device_id, ip_key, created_at)
       SELECT ?1, ?2, ?4, ?3
       WHERE EXISTS (SELECT 1 FROM wishes WHERE id = ?1 AND (status = 'approved' OR (?6 = 1 AND status = 'open')))
         AND (?5 IS NULL OR (SELECT COUNT(*) FROM wish_upvotes WHERE wish_id = ?1 AND ip_key = ?4) < ?5)`,
    )
    .bind(wishId, deviceId, now, network?.ipKey ?? null, network?.limit ?? null, allowOpen ? 1 : 0)
    .run();
  return result.meta.changes === 1;
}

export async function upvoteWish(
  db: D1Database,
  wishId: number,
  deviceId: string,
  now: number,
  network?: UpvoteNetwork,
): Promise<boolean> {
  return insertUpvote(db, wishId, deviceId, now, network, false);
}

export interface WishView {
  id: number;
  key: string;
  uri: string;
  status: string;
  title: string;
  artist: string;
  image_url: string | null;
  upvotes: number;
  mine: boolean;
  upvoted: boolean;
  created_at: number;
}

export async function guestWishes(db: D1Database, deviceId: string): Promise<WishView[]> {
  const { results } = await db
    .prepare(
      `SELECT w.id, w.created_at, s.spotify_uri AS uri, s.title, s.artist, s.image_url,
              CASE WHEN w.status = 'approved' AND EXISTS (
                SELECT 1 FROM playback p
                WHERE p.wish_id = w.id AND p.status IN ('planned', 'queuing', 'queued', 'unknown', 'playing')
              ) THEN 'queued' ELSE w.status END AS status,
              (SELECT COUNT(*) FROM wish_upvotes u WHERE u.wish_id = w.id) AS upvotes,
              (w.device_id = ?1) AS mine,
              EXISTS (SELECT 1 FROM wish_upvotes u WHERE u.wish_id = w.id AND u.device_id = ?1) AS upvoted
       FROM wishes w JOIN songs s ON s.id = w.song_id
       WHERE w.device_id = ?1 OR w.status IN ('approved', 'played')
       ORDER BY (w.device_id = ?1) DESC, upvotes DESC, w.created_at DESC
       LIMIT 60`,
    )
    .bind(deviceId)
    .all<Omit<WishView, 'key' | 'mine' | 'upvoted'> & { mine: number; upvoted: number }>();
  return results.map((r) => ({ ...r, key: wishKey(r.id), mine: r.mine === 1, upvoted: r.upvoted === 1 }));
}

export async function decideWish(
  db: D1Database,
  wishId: number,
  decision: { approve: true; setId: number; level: number | null } | { approve: false },
  userId: number,
  now: number,
): Promise<{ before: unknown; after: unknown }> {
  const wish = await db
    .prepare('SELECT id, song_id, status FROM wishes WHERE id = ?1')
    .bind(wishId)
    .first<{ id: number; song_id: number; status: string }>();
  if (!wish) throw new WishError('wish_not_found');
  if (!decision.approve) return vetoWish(db, wish, userId, now);
  if (wish.status !== 'open') throw new WishError('wish_not_open');
  if (!(await setExists(db, decision.setId))) throw new WishError('set_not_found');
  const approvedNow = "EXISTS (SELECT 1 FROM wishes WHERE id = ?3 AND status = 'approved' AND decided_at = ?4)";
  const statements = [
    db
      .prepare(
        "UPDATE wishes SET status = 'approved', decided_at = ?2, decided_by = ?3 WHERE id = ?1 AND status = 'open'",
      )
      .bind(wishId, now, userId),
    db
      .prepare(
        `INSERT OR IGNORE INTO set_songs (set_id, song_id, added_at, source) SELECT ?1, ?2, ?4, 'wish' WHERE ${approvedNow}`,
      )
      .bind(decision.setId, wish.song_id, wishId, now),
  ];
  if (decision.level !== null) {
    statements.push(
      db
        .prepare(`UPDATE songs SET mood_level = ?2 WHERE id = ?1 AND ${approvedNow}`)
        .bind(wish.song_id, decision.level, wishId, now),
    );
  }
  const [approved] = await db.batch(statements);
  if (approved?.meta.changes !== 1) throw new WishError('wish_not_open');
  return { before: wish, after: { status: 'approved', setId: decision.setId, level: decision.level } };
}

async function vetoWish(
  db: D1Database,
  wish: { id: number; song_id: number; status: string },
  userId: number,
  now: number,
): Promise<{ before: unknown; after: unknown }> {
  if (wish.status !== 'open' && wish.status !== 'approved') throw new WishError('wish_not_open');
  const vetoedNow = "EXISTS (SELECT 1 FROM wishes WHERE id = ?2 AND status = 'rejected' AND decided_at = ?3)";
  const [rejected, , , cancelled] = await db.batch([
    db
      .prepare(
        `UPDATE wishes SET status = 'rejected', decided_at = ?2, decided_by = ?3
         WHERE id = ?1 AND status IN ('open', 'approved')`,
      )
      .bind(wish.id, now, userId),
    db.prepare(`UPDATE songs SET vetoed = 1 WHERE id = ?1 AND ${vetoedNow}`).bind(wish.song_id, wish.id, now),
    db
      .prepare(`DELETE FROM set_songs WHERE song_id = ?1 AND source = 'wish' AND ${vetoedNow}`)
      .bind(wish.song_id, wish.id, now),
    db
      .prepare(`UPDATE playback SET status = 'cancelled' WHERE song_id = ?1 AND status = 'planned' AND ${vetoedNow}`)
      .bind(wish.song_id, wish.id, now),
  ]);
  if (rejected?.meta.changes !== 1) throw new WishError('wish_not_open');
  return {
    before: wish,
    after: { status: 'rejected', vetoed: true, cancelledPlayback: cancelled?.meta.changes ?? 0 },
  };
}

export async function reclassifyWishSongs(
  db: D1Database,
  blockedTags: string[],
  now: number,
): Promise<{ blocked: number; unblocked: number }> {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.blocked_tag, t.tags
       FROM songs s JOIN artist_tags t ON t.artist_key = s.artist_key AND t.fetched_at > 0
       WHERE EXISTS (SELECT 1 FROM wishes w WHERE w.song_id = s.id)
         AND NOT EXISTS (SELECT 1 FROM set_songs x WHERE x.song_id = s.id AND x.source = 'admin')`,
    )
    .all<{ id: number; blocked_tag: string | null; tags: string }>();
  const blocked = blockedTermSet(blockedTags);
  const block = new Map<string, number[]>();
  const unblock: number[] = [];
  for (const row of results) {
    const verdict = classify(JSON.parse(row.tags) as ArtistTag[], blocked);
    if (verdict.blockedTag === row.blocked_tag) continue;
    if (verdict.blockedTag === null) unblock.push(row.id);
    else block.set(verdict.blockedTag, [...(block.get(verdict.blockedTag) ?? []), row.id]);
  }
  const ids = (list: number[], offset: number) => list.map((_, i) => `?${i + offset}`).join(', ');
  const statements: D1PreparedStatement[] = [];
  for (const [tag, songIds] of block) {
    for (const part of chunk(songIds, 90)) {
      statements.push(
        db.prepare(`UPDATE songs SET blocked_tag = ?1 WHERE id IN (${ids(part, 2)})`).bind(tag, ...part),
        db
          .prepare(
            `UPDATE wishes SET status = 'rejected', decided_at = ?1
             WHERE status IN ('open', 'approved') AND song_id IN (${ids(part, 2)})`,
          )
          .bind(now, ...part),
      );
    }
  }
  for (const part of chunk(unblock, 90)) {
    statements.push(db.prepare(`UPDATE songs SET blocked_tag = NULL WHERE id IN (${ids(part, 1)})`).bind(...part));
  }
  if (statements.length) await db.batch(statements);
  return { blocked: [...block.values()].reduce((sum, list) => sum + list.length, 0), unblocked: unblock.length };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
