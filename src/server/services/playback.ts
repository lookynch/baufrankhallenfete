import { tracksMatch } from './library.ts';
import { getKv, setKv } from './kv.ts';
import type { PlaybackSnapshot, SpotifyApi } from './spotify-api.ts';

export const PENDING_STATUSES = ['queuing', 'queued', 'unknown'] as const;
export const ACTIVE_STATUSES = ['planned', 'queuing', 'queued', 'unknown', 'playing'] as const;
const QUEUING_TIMEOUT_MS = 30_000;
const PLAYED_TOLERANCE_MS = 15_000;

export type PlaybackStatus =
  'planned' | 'queuing' | 'queued' | 'unknown' | 'playing' | 'played' | 'skipped' | 'missed' | 'cancelled';

export interface PlaybackEntry {
  id: number;
  seq: number;
  round_id: number | null;
  song_id: number;
  source: 'winner' | 'manual';
  position: number;
  votes: number;
  status: PlaybackStatus;
  retry_at: number | null;
  attempts: number;
  queued_at: number | null;
  started_at: number | null;
  anchor_at: number | null;
  spotify_uri: string;
  isrc: string | null;
  title: string;
  artist: string;
  image_url: string | null;
  duration_ms: number;
  title_norm: string;
  artist_norm: string;
  mood_level: number | null;
}

export interface StoredSnapshot {
  fetchedAt: number;
  snapshot: PlaybackSnapshot | null;
  error: string | null;
}

const SNAPSHOT_FRESH_MS = 60_000;

export function snapshotFresh(snapshot: StoredSnapshot | null, now: number): snapshot is StoredSnapshot {
  return Boolean(snapshot && snapshot.snapshot && now - snapshot.fetchedAt < SNAPSHOT_FRESH_MS);
}

export interface ScheduledEntry extends PlaybackEntry {
  scheduledStart: number;
  scheduledEnd: number;
}

export async function activeEntries(db: D1Database): Promise<PlaybackEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.seq, p.round_id, p.song_id, p.source, p.position, p.votes, p.status, p.retry_at, p.attempts,
              p.queued_at, p.started_at, r.anchor_at, r.mood_level,
              s.spotify_uri, s.isrc, s.title, s.artist, s.image_url, s.duration_ms, s.title_norm, s.artist_norm
       FROM playback p
       JOIN songs s ON s.id = p.song_id
       LEFT JOIN rounds r ON r.id = p.round_id
       WHERE p.status IN ('planned', 'queuing', 'queued', 'unknown', 'playing')
       ORDER BY p.seq`,
    )
    .all<PlaybackEntry>();
  return results;
}

export function computeSchedule(
  entries: PlaybackEntry[],
  now: number,
  snapshot: StoredSnapshot | null,
): ScheduledEntry[] {
  const track = snapshotFresh(snapshot, now) ? snapshot.snapshot?.track : null;
  const foreignEndsAt =
    track && snapshot?.snapshot && !entries.some((e) => e.status === 'playing')
      ? snapshot.fetchedAt + track.durationMs - snapshot.snapshot.progressMs
      : null;
  let cursor: number | null = null;
  return entries.map((entry) => {
    let start: number;
    if (entry.status === 'playing' && entry.started_at !== null) {
      start = entry.started_at;
    } else {
      start = Math.max(cursor ?? entry.anchor_at ?? now, entry.anchor_at ?? 0);
      if (cursor === null && foreignEndsAt !== null) start = Math.max(start, foreignEndsAt);
      if (entry.queued_at !== null && entry.status !== 'planned') start = Math.max(start, entry.queued_at);
    }
    const end = start + entry.duration_ms;
    cursor = end;
    return { ...entry, scheduledStart: start, scheduledEnd: end };
  });
}

function matchesEntry(snapshot: PlaybackSnapshot, entry: PlaybackEntry): boolean {
  const track = snapshot.track;
  if (!track) return false;
  return tracksMatch(
    { uri: track.uri, isrc: track.isrc, title: track.title, artist: track.artist, durationMs: track.durationMs },
    entry,
  );
}

function finishedStatus(entry: PlaybackEntry, at: number): 'played' | 'skipped' {
  if (entry.started_at === null) return 'played';
  return at - entry.started_at >= entry.duration_ms - PLAYED_TOLERANCE_MS ? 'played' : 'skipped';
}

async function playedSince(spotify: SpotifyApi, entry: PlaybackEntry): Promise<number | null> {
  const recent = await spotify.recentlyPlayed();
  if (!recent.ok) return null;
  const since = (entry.queued_at ?? 0) - 5_000;
  const hit = recent.value.find(
    (item) =>
      item.playedAt >= since &&
      tracksMatch(
        {
          uri: item.track.uri,
          isrc: item.track.isrc,
          title: item.track.title,
          artist: item.track.artist,
          durationMs: item.track.durationMs,
        },
        entry,
      ),
  );
  return hit?.playedAt ?? null;
}

export async function reconcile(
  db: D1Database,
  spotify: SpotifyApi,
  snapshot: PlaybackSnapshot,
  fetchedAt: number,
): Promise<void> {
  const entries = await activeEntries(db);
  const playing = entries.find((e) => e.status === 'playing');
  const pending = entries.find((e) => (PENDING_STATUSES as readonly string[]).includes(e.status));
  const statements: D1PreparedStatement[] = [];
  const finish = (entry: PlaybackEntry) =>
    statements.push(
      db
        .prepare("UPDATE playback SET status = ?2, ended_at = ?3 WHERE id = ?1 AND status = 'playing'")
        .bind(entry.id, finishedStatus(entry, fetchedAt), fetchedAt),
    );

  if (!snapshot.track) return;

  if (pending && matchesEntry(snapshot, pending)) {
    if (playing) finish(playing);
    statements.push(
      db
        .prepare(
          "UPDATE playback SET status = 'playing', started_at = ?2 WHERE id = ?1 AND status IN ('queuing', 'queued', 'unknown')",
        )
        .bind(pending.id, fetchedAt - snapshot.progressMs),
    );
  } else if (playing && matchesEntry(snapshot, playing)) {
    return;
  } else {
    const matchingPlanned = entries.find((e) => e.status === 'planned' && matchesEntry(snapshot, e));
    if (playing) finish(playing);
    if (matchingPlanned) {
      statements.push(
        db
          .prepare("UPDATE playback SET status = 'playing', started_at = ?2 WHERE id = ?1 AND status = 'planned'")
          .bind(matchingPlanned.id, fetchedAt - snapshot.progressMs),
      );
    } else {
      const foreignStartedAt = fetchedAt - snapshot.progressMs;
      if (pending && (playing || foreignStartedAt > (pending.queued_at ?? 0) + 2_000)) {
        const playedAt = await playedSince(spotify, pending);
        statements.push(
          playedAt !== null
            ? db
                .prepare(
                  "UPDATE playback SET status = 'played', started_at = ?2, ended_at = ?3 WHERE id = ?1 AND status IN ('queued', 'unknown', 'queuing')",
                )
                .bind(pending.id, playedAt - pending.duration_ms, playedAt)
            : db
                .prepare(
                  "UPDATE playback SET status = 'planned', retry_at = NULL, error = 'not_played_after_previous' WHERE id = ?1 AND status IN ('queued', 'unknown', 'queuing')",
                )
                .bind(pending.id),
        );
      }
      const appHasPlayed = await db
        .prepare('SELECT 1 AS x FROM playback WHERE started_at IS NOT NULL LIMIT 1')
        .first<{ x: number }>();
      await recordObservedPlay(db, snapshot, fetchedAt, appHasPlayed ? 'emergency' : 'preshow');
    }
  }
  if (statements.length) await db.batch(statements);
}

async function recordObservedPlay(
  db: D1Database,
  snapshot: PlaybackSnapshot,
  at: number,
  kind: 'preshow' | 'emergency',
): Promise<void> {
  const uri = snapshot.track?.uri;
  if (!uri) return;
  const last = await getKv<string>(db, 'last_observed_uri');
  if (last?.value === uri) return;
  await db
    .prepare('INSERT INTO observed_plays (at, spotify_uri, title, artist, kind) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(at, uri, snapshot.track?.title ?? null, snapshot.track?.artist ?? null, kind)
    .run();
  await setKv(db, 'last_observed_uri', uri, at);
}

export async function expireStale(db: D1Database, now: number, snapshot: StoredSnapshot | null): Promise<void> {
  const observing = snapshotFresh(snapshot, now);
  const schedule = computeSchedule(await activeEntries(db), now, snapshot);
  const statements: D1PreparedStatement[] = [];
  for (const entry of schedule) {
    const overdue = entry.scheduledEnd + 60_000 < now;
    if (entry.status === 'queuing' && entry.queued_at !== null && now - entry.queued_at > QUEUING_TIMEOUT_MS) {
      statements.push(
        db.prepare("UPDATE playback SET status = 'unknown' WHERE id = ?1 AND status = 'queuing'").bind(entry.id),
      );
    } else if (
      entry.status === 'playing' &&
      entry.started_at !== null &&
      now > entry.started_at + entry.duration_ms + 60_000
    ) {
      statements.push(
        db
          .prepare("UPDATE playback SET status = 'played', ended_at = ?2 WHERE id = ?1 AND status = 'playing'")
          .bind(entry.id, entry.started_at + entry.duration_ms),
      );
    } else if (entry.status === 'queued' && overdue && !observing) {
      statements.push(
        db
          .prepare(
            "UPDATE playback SET status = 'played', ended_at = ?2, error = 'assumed_played' WHERE id = ?1 AND status = 'queued'",
          )
          .bind(entry.id, entry.scheduledEnd),
      );
    } else if ((entry.status === 'planned' || entry.status === 'unknown') && overdue) {
      statements.push(
        db
          .prepare(
            "UPDATE playback SET status = 'missed', ended_at = ?2 WHERE id = ?1 AND status IN ('planned', 'unknown')",
          )
          .bind(entry.id, now),
      );
    }
  }
  if (statements.length) await db.batch(statements);
}

const RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 30_000];

export async function queueNext(
  db: D1Database,
  spotify: SpotifyApi,
  now: number,
): Promise<'queued' | 'idle' | 'failed'> {
  const entries = await activeEntries(db);
  if (entries.some((e) => (PENDING_STATUSES as readonly string[]).includes(e.status))) return 'idle';
  const next = entries.find((e) => e.status === 'planned' && (e.retry_at === null || e.retry_at <= now));
  if (!next) return 'idle';
  const claim = await db
    .prepare(
      `UPDATE playback SET status = 'queuing', queued_at = ?2, attempts = attempts + 1
       WHERE id = ?1 AND status = 'planned'
         AND NOT EXISTS (SELECT 1 FROM playback WHERE status IN ('queuing', 'queued', 'unknown'))`,
    )
    .bind(next.id, now)
    .run();
  if (claim.meta.changes !== 1) return 'idle';
  const result = await spotify.addToQueue(next.spotify_uri);
  if (result.ok) {
    await db
      .prepare("UPDATE playback SET status = 'queued', error = NULL WHERE id = ?1 AND status = 'queuing'")
      .bind(next.id)
      .run();
    return 'queued';
  }
  if (result.kind === 'unknown') {
    await db
      .prepare("UPDATE playback SET status = 'unknown', error = ?2 WHERE id = ?1 AND status = 'queuing'")
      .bind(next.id, `unknown:${result.status ?? 'network'}`)
      .run();
    return 'failed';
  }
  const delay = RETRY_DELAYS_MS[Math.min(next.attempts, RETRY_DELAYS_MS.length - 1)]!;
  await db
    .prepare("UPDATE playback SET status = 'planned', retry_at = ?2, error = ?3 WHERE id = ?1 AND status = 'queuing'")
    .bind(next.id, now + delay, result.kind)
    .run();
  return 'failed';
}

export function nextTickAt(schedule: ScheduledEntry[], openRoundCloseAt: number | null, now: number): number | null {
  const candidates: number[] = [];
  if (openRoundCloseAt !== null) candidates.push(openRoundCloseAt + 1_000);
  const playing = schedule.find((e) => e.status === 'playing');
  if (playing) candidates.push(playing.scheduledEnd + 2_000);
  const pending = schedule.find((e) => e.status !== 'playing');
  if (pending) candidates.push(pending.scheduledStart + 2_000);
  const future = candidates.filter((t) => t > now);
  return future.length ? Math.max(now + 2_000, Math.min(...future)) : null;
}
