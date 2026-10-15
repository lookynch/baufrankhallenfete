import type { Settings } from '../../shared/settings.ts';
import type { IpFamily } from '../security/ip.ts';

export type VoteOutcome = 'ok' | 'round_closed' | 'not_candidate' | 'ip_limit';

export interface VoteInput {
  roundId: number;
  songId: number;
  deviceId: string;
  ipKey: string;
  ipFamily: IpFamily;
  verified: boolean;
  fpHash: string | null;
  now: number;
}

export function ipVoteLimit(settings: Settings, family: IpFamily, verified: boolean): number {
  if (!verified) return 1;
  return family === 'v6' ? settings.security.votesPerIpV6 : settings.security.votesPerIpV4;
}

export async function castVote(db: D1Database, settings: Settings, input: VoteInput): Promise<VoteOutcome> {
  const limit = ipVoteLimit(settings, input.ipFamily, input.verified);
  const result = await db
    .prepare(
      `INSERT INTO votes (round_id, device_id, ip_key, fp_hash, song_id, verified, created_at, updated_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7
       WHERE EXISTS (SELECT 1 FROM rounds WHERE id = ?1 AND status = 'open')
         AND EXISTS (SELECT 1 FROM round_candidates WHERE round_id = ?1 AND song_id = ?5)
         AND (
           EXISTS (SELECT 1 FROM votes WHERE round_id = ?1 AND device_id = ?2)
           OR (SELECT COUNT(*) FROM votes WHERE round_id = ?1 AND ip_key = ?3 AND device_id <> ?2 AND invalidated = 0) < ?8
         )
       ON CONFLICT (round_id, device_id) DO UPDATE SET song_id = excluded.song_id, updated_at = excluded.updated_at`,
    )
    .bind(
      input.roundId,
      input.deviceId,
      input.ipKey,
      input.fpHash,
      input.songId,
      input.verified ? 1 : 0,
      input.now,
      limit,
    )
    .run();
  if (result.meta.changes === 1) return 'ok';
  const state = await db
    .prepare(
      `SELECT
         (SELECT status FROM rounds WHERE id = ?1) AS status,
         (SELECT COUNT(*) FROM round_candidates WHERE round_id = ?1 AND song_id = ?2) AS candidate`,
    )
    .bind(input.roundId, input.songId)
    .first<{ status: string | null; candidate: number }>();
  if (state?.status !== 'open') return 'round_closed';
  if (!state.candidate) return 'not_candidate';
  return 'ip_limit';
}

export async function myVote(db: D1Database, roundId: number, deviceId: string): Promise<number | null> {
  const row = await db
    .prepare('SELECT song_id FROM votes WHERE round_id = ?1 AND device_id = ?2 AND invalidated = 0')
    .bind(roundId, deviceId)
    .first<{ song_id: number }>();
  return row?.song_id ?? null;
}
