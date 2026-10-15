import { activeEntries, computeSchedule, type ScheduledEntry, type StoredSnapshot } from './services/playback.ts';
import { expectedCloseAt, tally, type RoundRow } from './services/rounds.ts';
import { wishKey } from './services/wishes.ts';

export interface CandidateView {
  songId: number;
  title: string;
  artist: string;
  imageUrl: string | null;
  durationMs: number;
  explicit: boolean;
  wishKey: string | null;
  votes?: number;
}

export interface RoundView {
  id: number;
  seq: number;
  level: number;
  setName: string | null;
  openedAt: number;
  expectedCloseAt: number;
  candidates: CandidateView[];
  totalVotes?: number;
}

export async function roundView(
  db: D1Database,
  round: RoundRow,
  now: number,
  options: { includeTally: boolean; schedule?: ScheduledEntry[]; snapshot?: StoredSnapshot | null },
): Promise<RoundView> {
  const schedule = options.schedule ?? computeSchedule(await activeEntries(db), now, options.snapshot ?? null);
  const { results } = await db
    .prepare(
      `SELECT c.song_id, c.wish_id, s.title, s.artist, s.image_url, s.duration_ms, s.explicit, st.name AS set_name
       FROM round_candidates c
       JOIN songs s ON s.id = c.song_id
       JOIN rounds r ON r.id = c.round_id
       LEFT JOIN sets st ON st.id = r.set_id
       WHERE c.round_id = ?1 ORDER BY c.position`,
    )
    .bind(round.id)
    .all<{
      song_id: number;
      wish_id: number | null;
      title: string;
      artist: string;
      image_url: string | null;
      duration_ms: number;
      explicit: number;
      set_name: string | null;
    }>();
  const votes = options.includeTally ? new Map((await tally(db, round.id)).map((t) => [t.song_id, t.votes])) : null;
  const candidates = results.map(
    (r): CandidateView => ({
      songId: r.song_id,
      title: r.title,
      artist: r.artist,
      imageUrl: r.image_url,
      durationMs: r.duration_ms,
      explicit: r.explicit === 1,
      wishKey: r.wish_id ? wishKey(r.wish_id) : null,
      ...(votes ? { votes: votes.get(r.song_id) ?? 0 } : {}),
    }),
  );
  return {
    id: round.id,
    seq: round.seq,
    level: round.mood_level,
    setName: results[0]?.set_name ?? null,
    openedAt: round.opened_at,
    expectedCloseAt: expectedCloseAt(round, schedule),
    candidates,
    ...(votes ? { totalVotes: [...votes.values()].reduce((a, b) => a + b, 0) } : {}),
  };
}

export function nowPlayingView(snapshot: StoredSnapshot | null) {
  const track = snapshot?.snapshot?.track;
  if (!snapshot?.snapshot || !track) return null;
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    imageUrl: track.imageUrl,
    durationMs: track.durationMs,
    progressMs: snapshot.snapshot.progressMs,
    isPlaying: snapshot.snapshot.isPlaying,
    fetchedAt: snapshot.fetchedAt,
  };
}

export function upNextView(schedule: ScheduledEntry[], limit = 8) {
  return schedule
    .filter((e) => e.status !== 'playing')
    .slice(0, limit)
    .map((e) => ({
      id: e.id,
      title: e.title,
      artist: e.artist,
      imageUrl: e.image_url,
      level: e.mood_level,
      votes: e.votes,
      status: e.status,
      scheduledStart: e.scheduledStart,
    }));
}
