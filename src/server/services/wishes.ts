import { trackIdFromUri } from '../../shared/spotify.ts';
import { hitRateLimit } from '../security/ratelimit.ts';
import { ensureSong, normalizeTitle } from './library.ts';
import type { SpotifyApi, SpotifyTrack } from './spotify-api.ts';

export class WishError extends Error {}

const SEARCH_CACHE_MS = 15 * 60_000;
const GLOBAL_SEARCH_LIMIT = 10;
const GLOBAL_SEARCH_WINDOW_S = 30;
const GLOBAL_TRACK_LIMIT = 10;
const GLOBAL_TRACK_WINDOW_S = 30;
const OPEN_WISHES_PER_DEVICE = 3;

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

export async function searchTracks(
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
    return { tracks: JSON.parse(cached.results) as SpotifyTrack[], limited: false, unavailable: false };
  }
  const budget = await hitRateLimit(db, 'spotify:search', GLOBAL_SEARCH_LIMIT, GLOBAL_SEARCH_WINDOW_S, now);
  if (!budget.allowed) {
    return {
      tracks: cached ? (JSON.parse(cached.results) as SpotifyTrack[]) : [],
      limited: !cached,
      unavailable: false,
    };
  }
  const result = await spotify.search(query.slice(0, 100));
  if (!result.ok) {
    const rateLimited = result.kind === 'rate_limited';
    return {
      tracks: cached ? (JSON.parse(cached.results) as SpotifyTrack[]) : [],
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
    const match = (JSON.parse(row.results) as SpotifyTrack[]).find((t) => t.uri === uri);
    if (match) return match;
  }
  return null;
}

export async function createWish(
  db: D1Database,
  spotify: SpotifyApi,
  deviceId: string,
  uri: string,
  now: number,
  network?: UpvoteNetwork,
): Promise<{ id: number; key: string; status: string; merged: boolean }> {
  const trackId = trackIdFromUri(uri);
  if (!trackId) throw new WishError('invalid_track');
  const open = await db
    .prepare("SELECT COUNT(*) AS n FROM wishes WHERE device_id = ?1 AND status = 'open'")
    .bind(deviceId)
    .first<{ n: number }>();
  if ((open?.n ?? 0) >= OPEN_WISHES_PER_DEVICE) throw new WishError('too_many_open_wishes');

  let track = await trackFromCache(db, uri);
  if (!track) {
    const budget = await hitRateLimit(db, 'spotify:track', GLOBAL_TRACK_LIMIT, GLOBAL_TRACK_WINDOW_S, now);
    if (!budget.allowed) throw new WishError('limited');
    const fetched = await spotify.track(trackId);
    if (!fetched.ok) throw new WishError('track_unavailable');
    track = fetched.value;
  }
  const song = await ensureSong(db, track, now);
  const played = await db
    .prepare("SELECT 1 AS x FROM playback WHERE song_id = ?1 AND status IN ('playing', 'played') LIMIT 1")
    .bind(song.id)
    .first();
  if (played) throw new WishError('already_played');

  const inserted = await db
    .prepare(
      `INSERT INTO wishes (song_id, device_id, status, created_at)
       SELECT ?1, ?2, 'open', ?3
       WHERE NOT EXISTS (SELECT 1 FROM wishes WHERE song_id = ?1 AND status IN ('open', 'approved'))
       ON CONFLICT DO NOTHING RETURNING id, status`,
    )
    .bind(song.id, deviceId, now)
    .first<{ id: number; status: string }>();
  if (inserted) return { id: inserted.id, key: wishKey(inserted.id), status: inserted.status, merged: false };

  const existing = await db
    .prepare("SELECT id, status FROM wishes WHERE song_id = ?1 AND status IN ('open', 'approved')")
    .bind(song.id)
    .first<{ id: number; status: string }>();
  if (!existing) throw new WishError('wish_conflict');
  await insertUpvote(db, existing.id, deviceId, now, network, true);
  return { id: existing.id, key: wishKey(existing.id), status: existing.status, merged: true };
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
      `SELECT w.id, w.status, w.created_at, s.spotify_uri AS uri, s.title, s.artist, s.image_url,
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
  if (!decision.approve) {
    await db
      .prepare("UPDATE wishes SET status = 'rejected', decided_at = ?2, decided_by = ?3 WHERE id = ?1")
      .bind(wishId, now, userId)
      .run();
    return { before: wish, after: { status: 'rejected' } };
  }
  const statements = [
    db
      .prepare("UPDATE wishes SET status = 'approved', decided_at = ?2, decided_by = ?3 WHERE id = ?1")
      .bind(wishId, now, userId),
    db
      .prepare('INSERT OR IGNORE INTO set_songs (set_id, song_id, added_at) VALUES (?1, ?2, ?3)')
      .bind(decision.setId, wish.song_id, now),
  ];
  if (decision.level !== null) {
    statements.push(db.prepare('UPDATE songs SET mood_level = ?2 WHERE id = ?1').bind(wish.song_id, decision.level));
  }
  await db.batch(statements);
  return { before: wish, after: { status: 'approved', setId: decision.setId, level: decision.level } };
}
