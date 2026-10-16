import { MIN_VOTING_MINUTES, type MoodLevel } from '../../shared/settings.ts';
import { artistKey } from './genres.ts';
import type { SpotifyTrack } from './spotify-api.ts';

export class LibraryError extends Error {}

export interface SongRow {
  id: number;
  spotify_uri: string;
  isrc: string | null;
  title: string;
  artist: string;
  album: string | null;
  image_url: string | null;
  duration_ms: number;
  explicit: number;
  mood_level: number | null;
  title_norm: string;
  artist_norm: string;
  active: number;
  artist_key: string | null;
  auto_level: number | null;
  blocked_tag: string | null;
  vetoed: number;
}

export interface SetRow {
  id: number;
  name: string;
  starts_at: number;
  ends_at: number;
  default_level: number;
}

export function normalizeTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*[([].*?(feat|ft\.|with|remaster|version|edit|mix|live|mono|stereo).*?[)\]]/g, '')
    .replace(/\s+-\s+.*(remaster|version|edit|mix|live|mono|stereo).*$/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizeArtist(value: string): string {
  return normalizeTitle(value.split(/,|&| feat\.? | ft\.? | x /i)[0] ?? value);
}

const SONG_COLUMNS = 13;
const ROWS_PER_STATEMENT = Math.floor(100 / SONG_COLUMNS);

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

interface UpsertOptions {
  adminOverride: boolean;
  autoLevel: number | null;
}

export function songUpsertStatements(
  db: D1Database,
  tracks: SpotifyTrack[],
  now: number,
  { adminOverride, autoLevel }: UpsertOptions,
): D1PreparedStatement[] {
  return chunk(dedupeTracks(tracks), ROWS_PER_STATEMENT).map((rows) => {
    const values = rows.map(
      (_, i) => `(${Array.from({ length: SONG_COLUMNS }, (_, c) => `?${i * SONG_COLUMNS + c + 1}`).join(', ')})`,
    );
    const params = rows.flatMap((t) => [
      t.uri,
      t.isrc,
      t.title,
      t.artist,
      t.album,
      t.imageUrl,
      t.durationMs,
      t.explicit ? 1 : 0,
      normalizeTitle(t.title),
      normalizeArtist(t.artist),
      t.artists[0] ? artistKey(t.artists[0]) : null,
      autoLevel,
      now,
    ]);
    return db
      .prepare(
        `INSERT INTO songs (spotify_uri, isrc, title, artist, album, image_url, duration_ms, explicit, title_norm, artist_norm, artist_key, auto_level, created_at)
         SELECT * FROM (VALUES ${values.join(', ')}) AS v
         WHERE NOT EXISTS (SELECT 1 FROM songs s WHERE v.column2 IS NOT NULL AND s.isrc = v.column2 AND s.spotify_uri <> v.column1)
         ON CONFLICT (spotify_uri) DO UPDATE SET
           isrc = COALESCE(excluded.isrc, songs.isrc),
           title = excluded.title,
           artist = excluded.artist,
           album = excluded.album,
           image_url = excluded.image_url,
           duration_ms = excluded.duration_ms,
           explicit = excluded.explicit,
           title_norm = excluded.title_norm,
           artist_norm = excluded.artist_norm,
           artist_key = COALESCE(excluded.artist_key, songs.artist_key)${
             adminOverride ? ', blocked_tag = NULL, vetoed = 0' : ''
           }`,
      )
      .bind(...params);
  });
}

function dedupeTracks(tracks: SpotifyTrack[]): SpotifyTrack[] {
  const seen = new Set<string>();
  return tracks.filter((t) => {
    const key = t.isrc ?? t.uri;
    if (seen.has(key) || seen.has(t.uri)) return false;
    seen.add(key);
    seen.add(t.uri);
    return true;
  });
}

function setSongStatements(db: D1Database, setId: number, tracks: SpotifyTrack[], now: number): D1PreparedStatement[] {
  return chunk(dedupeTracks(tracks), 45).map((rows) => {
    const uris = rows.map((t) => t.uri);
    const isrcs = rows.map((t) => t.isrc).filter((v): v is string => v !== null);
    const uriParams = uris.map((_, i) => `?${i + 3}`).join(', ');
    const isrcParams = isrcs.map((_, i) => `?${i + 3 + uris.length}`).join(', ');
    return db
      .prepare(
        `INSERT INTO set_songs (set_id, song_id, added_at, source)
         SELECT ?1, id, ?2, 'admin' FROM songs WHERE spotify_uri IN (${uriParams})${isrcs.length ? ` OR isrc IN (${isrcParams})` : ''}
         ON CONFLICT (set_id, song_id) DO UPDATE SET source = 'admin'`,
      )
      .bind(setId, now, ...uris, ...isrcs);
  });
}

export async function setExists(db: D1Database, setId: number): Promise<boolean> {
  return (await db.prepare('SELECT 1 AS found FROM sets WHERE id = ?1').bind(setId).first()) !== null;
}

export async function importTracks(
  db: D1Database,
  tracks: SpotifyTrack[],
  setId: number | null,
  now: number,
): Promise<{ imported: number }> {
  if (tracks.length === 0) return { imported: 0 };
  if (tracks.length > 60) throw new LibraryError('too_many_tracks');
  if (setId !== null && !(await setExists(db, setId))) throw new LibraryError('set_not_found');
  const statements = songUpsertStatements(db, tracks, now, { adminOverride: true, autoLevel: null });
  if (setId !== null) statements.push(...setSongStatements(db, setId, tracks, now));
  await db.batch(statements);
  return { imported: dedupeTracks(tracks).length };
}

export async function songByUri(db: D1Database, uri: string): Promise<SongRow | null> {
  return db.prepare('SELECT * FROM songs WHERE spotify_uri = ?1').bind(uri).first<SongRow>();
}

export async function ensureSong(
  db: D1Database,
  track: SpotifyTrack,
  now: number,
  autoLevel: number | null = null,
): Promise<SongRow> {
  await db.batch(songUpsertStatements(db, [track], now, { adminOverride: false, autoLevel }));
  const direct = await songByUri(db, track.uri);
  if (direct) return direct;
  const viaIsrc = track.isrc
    ? await db.prepare('SELECT * FROM songs WHERE isrc = ?1 LIMIT 1').bind(track.isrc).first<SongRow>()
    : null;
  if (!viaIsrc) throw new LibraryError('song_not_stored');
  return viaIsrc;
}

export async function listSets(db: D1Database): Promise<SetRow[]> {
  const { results } = await db
    .prepare('SELECT id, name, starts_at, ends_at, default_level FROM sets ORDER BY starts_at')
    .all<SetRow>();
  return results;
}

export function setActiveAt(sets: SetRow[], at: number): SetRow | null {
  const sorted = [...sets].sort((a, b) => a.starts_at - b.starts_at);
  const current = sorted.find((s) => s.starts_at <= at && at < s.ends_at);
  if (current) return current;
  const previous = sorted.filter((s) => s.ends_at <= at).pop();
  return previous ?? sorted[0] ?? null;
}

export function assertNoOverlap(sets: SetRow[], candidate: Omit<SetRow, 'id'> & { id?: number }): void {
  if (candidate.ends_at <= candidate.starts_at) throw new LibraryError('set_end_before_start');
  if (!Number.isInteger(candidate.default_level) || candidate.default_level < 1 || candidate.default_level > 5) {
    throw new LibraryError('invalid_level');
  }
  const clash = sets.find(
    (s) => s.id !== candidate.id && s.starts_at < candidate.ends_at && candidate.starts_at < s.ends_at,
  );
  if (clash) throw new LibraryError(`set_overlaps:${clash.name}`);
}

export async function saveSet(
  db: D1Database,
  input: { id?: number; name: string; starts_at: number; ends_at: number; default_level: MoodLevel },
  now: number,
): Promise<number> {
  assertNoOverlap(await listSets(db), input);
  if (input.id) {
    await db
      .prepare('UPDATE sets SET name = ?2, starts_at = ?3, ends_at = ?4, default_level = ?5 WHERE id = ?1')
      .bind(input.id, input.name, input.starts_at, input.ends_at, input.default_level)
      .run();
    return input.id;
  }
  const row = await db
    .prepare(
      'INSERT INTO sets (name, starts_at, ends_at, default_level, created_at) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id',
    )
    .bind(input.name, input.starts_at, input.ends_at, input.default_level, now)
    .first<{ id: number }>();
  if (!row) throw new LibraryError('set_not_created');
  return row.id;
}

export interface SetCoverage {
  setId: number;
  name: string;
  durationMinutes: number;
  defaultLevel: number;
  byLevel: Record<number, { songs: number; minutes: number }>;
  nearbyMinutes: number;
  rampOk: boolean;
  ok: boolean;
}

type LevelCoverage = SetCoverage['byLevel'];

function rampPossible(from: number, to: number, maxStep: number, covered: (level: number) => boolean): boolean {
  const direction = Math.sign(to - from);
  let current = from;
  while (Math.abs(to - current) > maxStep) {
    let next: number | null = null;
    for (let step = maxStep; step >= 1 && next === null; step--) {
      if (covered(current + direction * step)) next = current + direction * step;
    }
    if (next === null) return false;
    current = next;
  }
  return true;
}

export async function setCoverage(
  db: D1Database,
  voting: { maxMoodStep: number; minRoundMinutes: number } = {
    maxMoodStep: 1,
    minRoundMinutes: MIN_VOTING_MINUTES,
  },
): Promise<SetCoverage[]> {
  const sets = await listSets(db);
  const { results } = await db
    .prepare(
      `SELECT ss.set_id, COALESCE(s.mood_level, s.auto_level, st.default_level) AS level, COUNT(*) AS songs, SUM(s.duration_ms) AS ms
       FROM set_songs ss
       JOIN songs s ON s.id = ss.song_id
       JOIN sets st ON st.id = ss.set_id
       WHERE s.active = 1 AND s.blocked_tag IS NULL AND s.vetoed = 0
         AND NOT EXISTS (SELECT 1 FROM playback p WHERE p.song_id = s.id AND p.status IN ('playing', 'played'))
       GROUP BY ss.set_id, level`,
    )
    .all<{ set_id: number; level: number; songs: number; ms: number }>();
  const levels = sets.map((set) => {
    const byLevel: LevelCoverage = {};
    for (const level of [1, 2, 3, 4, 5]) byLevel[level] = { songs: 0, minutes: 0 };
    for (const row of results.filter((r) => r.set_id === set.id)) {
      byLevel[row.level] = { songs: row.songs, minutes: Math.round(row.ms / 60_000) };
    }
    return byLevel;
  });
  return sets.map((set, index) => {
    const byLevel = levels[index]!;
    const previous = sets[index - 1];
    const previousLevels = levels[index - 1];
    const rampOk =
      !previous ||
      !previousLevels ||
      rampPossible(previous.default_level, set.default_level, voting.maxMoodStep, (level) => {
        const songs = (byLevel[level]?.songs ?? 0) + (previousLevels[level]?.songs ?? 0);
        const minutes = (byLevel[level]?.minutes ?? 0) + (previousLevels[level]?.minutes ?? 0);
        return songs >= 3 && minutes >= voting.minRoundMinutes + 4;
      });
    const durationMinutes = Math.round((set.ends_at - set.starts_at) / 60_000);
    const nearbyMinutes = [set.default_level - 1, set.default_level, set.default_level + 1]
      .map((l) => byLevel[l]?.minutes ?? 0)
      .reduce((a, b) => a + b, 0);
    return {
      setId: set.id,
      name: set.name,
      durationMinutes,
      defaultLevel: set.default_level,
      byLevel,
      nearbyMinutes,
      rampOk,
      ok: rampOk && nearbyMinutes >= durationMinutes * 1.5,
    };
  });
}

export function tracksMatch(
  a: { uri: string; isrc: string | null; title: string; artist: string; durationMs: number },
  b: { spotify_uri: string; isrc: string | null; title_norm: string; artist_norm: string; duration_ms: number },
): boolean {
  if (a.uri === b.spotify_uri) return true;
  if (a.isrc && b.isrc && a.isrc === b.isrc) return true;
  return (
    normalizeTitle(a.title) === b.title_norm &&
    normalizeArtist(a.artist) === b.artist_norm &&
    Math.abs(a.durationMs - b.duration_ms) <= 2_000
  );
}
