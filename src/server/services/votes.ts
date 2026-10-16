import type { Settings } from '../../shared/settings.ts';
import type { IpFamily } from '../security/ip.ts';

export type VoteOutcome = 'ok' | 'round_closed' | 'not_candidate' | 'ip_limit' | 'vote_invalidated';

export interface VoteInput {
  roundId: number;
  songId: number;
  deviceId: string;
  ipKey: string;
  netKey?: string;
  ipFamily: IpFamily;
  now: number;
}

export function ipVoteLimit(settings: Settings, family: IpFamily): number {
  return family === 'v6' ? settings.security.votesPerIpV6 : settings.security.votesPerIpV4;
}

export function netVoteLimit(settings: Settings, family: IpFamily): number | null {
  return family === 'v6' ? settings.security.votesPerNetV6 : null;
}

export async function castVote(db: D1Database, settings: Settings, input: VoteInput): Promise<VoteOutcome> {
  const result = await db
    .prepare(
      `INSERT INTO votes (round_id, device_id, ip_key, net_key, song_id, created_at, updated_at)
       SELECT ?1, ?2, ?3, ?7, ?4, ?5, ?5
       WHERE EXISTS (SELECT 1 FROM rounds WHERE id = ?1 AND status = 'open')
         AND EXISTS (SELECT 1 FROM round_candidates WHERE round_id = ?1 AND song_id = ?4)
         AND (
           EXISTS (SELECT 1 FROM votes WHERE round_id = ?1 AND device_id = ?2)
           OR (
             (SELECT COUNT(*) FROM votes WHERE round_id = ?1 AND ip_key = ?3 AND device_id <> ?2) < ?6
             AND (?8 IS NULL OR (SELECT COUNT(*) FROM votes WHERE round_id = ?1 AND net_key = ?7 AND device_id <> ?2) < ?8)
           )
         )
       ON CONFLICT (round_id, device_id) DO UPDATE SET song_id = excluded.song_id, updated_at = excluded.updated_at
       WHERE votes.invalidated = 0`,
    )
    .bind(
      input.roundId,
      input.deviceId,
      input.ipKey,
      input.songId,
      input.now,
      ipVoteLimit(settings, input.ipFamily),
      input.netKey ?? input.ipKey,
      netVoteLimit(settings, input.ipFamily),
    )
    .run();
  if (result.meta.changes === 1) return 'ok';
  const state = await db
    .prepare(
      `SELECT
         (SELECT status FROM rounds WHERE id = ?1) AS status,
         (SELECT COUNT(*) FROM round_candidates WHERE round_id = ?1 AND song_id = ?2) AS candidate,
         (SELECT invalidated FROM votes WHERE round_id = ?1 AND device_id = ?3) AS invalidated`,
    )
    .bind(input.roundId, input.songId, input.deviceId)
    .first<{ status: string | null; candidate: number; invalidated: number | null }>();
  if (state?.status !== 'open') return 'round_closed';
  if (!state.candidate) return 'not_candidate';
  if (state.invalidated === 1) return 'vote_invalidated';
  return 'ip_limit';
}

export async function myVote(db: D1Database, roundId: number, deviceId: string): Promise<number | null> {
  const row = await db
    .prepare('SELECT song_id FROM votes WHERE round_id = ?1 AND device_id = ?2 AND invalidated = 0')
    .bind(roundId, deviceId)
    .first<{ song_id: number }>();
  return row?.song_id ?? null;
}
