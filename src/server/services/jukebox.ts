import type { Settings } from '../../shared/settings.ts';
import { snapshotFresh, type StoredSnapshot } from './playback.ts';

const MAX_FAILED_ATTEMPTS = 2;

export function jukeboxOpen(
  settings: Settings,
  snapshot: StoredSnapshot | null,
  now: number,
  genreFilter: boolean,
): boolean {
  const { voting, event, wishes } = settings;
  if (!genreFilter || !wishes.autoApprove || !voting.enabled) return false;
  if (now < event.startsAt || now >= voting.startsAt) return false;
  return snapshotFresh(snapshot, now) && snapshot.snapshot!.isPlaying && snapshot.snapshot!.track !== null;
}

export async function markPlayedWishes(db: D1Database): Promise<void> {
  await db
    .prepare(
      `UPDATE wishes SET status = 'played'
       WHERE status = 'approved'
         AND EXISTS (
           SELECT 1 FROM playback p WHERE p.wish_id = wishes.id AND p.status IN ('playing', 'played', 'skipped')
         )`,
    )
    .run();
}

export async function planJukeboxWish(db: D1Database, settings: Settings, now: number): Promise<boolean> {
  try {
    const result = await db
      .prepare(
        `INSERT INTO playback (seq, round_id, song_id, source, position, votes, status, created_at, wish_id)
         SELECT (SELECT COALESCE(MAX(seq), 0) + 1 FROM playback), NULL, next.song_id, 'manual', 0, 0, 'planned', ?1, next.id
         FROM (
           SELECT w.id, w.song_id
           FROM wishes w JOIN songs s ON s.id = w.song_id
           WHERE w.status = 'approved' AND w.device_id <> 'anon'
             AND s.active = 1 AND s.blocked_tag IS NULL AND s.vetoed = 0
             AND (?2 = 1 OR s.explicit = 0)
             AND NOT EXISTS (
               SELECT 1 FROM playback p WHERE p.song_id = w.song_id AND p.status NOT IN ('missed', 'cancelled')
             )
             AND NOT EXISTS (
               SELECT 1 FROM round_candidates c JOIN rounds r ON r.id = c.round_id
               WHERE r.status = 'open' AND c.song_id = w.song_id
             )
             AND (
               SELECT COUNT(*) FROM playback f WHERE f.wish_id = w.id AND f.status IN ('missed', 'cancelled')
             ) < ?3
           ORDER BY COALESCE((
               SELECT MAX(j.created_at) FROM playback j JOIN wishes jw ON jw.id = j.wish_id
               WHERE jw.device_id = w.device_id AND j.status NOT IN ('missed', 'cancelled')
             ), 0) ASC,
             w.created_at ASC, w.id ASC
           LIMIT 1
         ) next
         WHERE NOT EXISTS (SELECT 1 FROM playback WHERE status IN ('planned', 'queuing', 'queued', 'unknown'))`,
      )
      .bind(now, settings.voting.allowExplicit ? 1 : 0, MAX_FAILED_ATTEMPTS)
      .run();
    return result.meta.changes === 1;
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) return false;
    throw error;
  }
}
