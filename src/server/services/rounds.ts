import type { Settings } from '../../shared/settings.ts';
import { randomInt, randomToken } from '../security/crypto.ts';
import { listSets, setActiveAt, type SetRow } from './library.ts';
import { planLevel } from './levels.ts';
import { activeEntries, computeSchedule, type ScheduledEntry, type StoredSnapshot } from './playback.ts';

const MINUTE = 60_000;
const MIN_OPEN_MS = 3 * MINUTE;
const CANDIDATE_BUFFER_MS = 6 * MINUTE;
const MAX_CANDIDATES = 30;

export interface RoundRow {
  id: number;
  seq: number;
  status: 'open' | 'closed' | 'skipped';
  mood_level: number;
  set_id: number | null;
  opened_at: number;
  close_at: number | null;
  closed_at: number | null;
  anchor_at: number | null;
}

interface PoolSong {
  id: number;
  duration_ms: number;
  level: number;
  wish_id: number | null;
  upvotes: number;
}

export async function openRound(db: D1Database): Promise<RoundRow | null> {
  return db.prepare("SELECT * FROM rounds WHERE status = 'open' LIMIT 1").first<RoundRow>();
}

export async function lastRound(db: D1Database): Promise<RoundRow | null> {
  return db.prepare('SELECT * FROM rounds ORDER BY seq DESC LIMIT 1').first<RoundRow>();
}

export function votingActive(settings: Settings, now: number): boolean {
  const { voting } = settings;
  return voting.enabled && now >= voting.startsAt && (voting.endsAt === null || now < voting.endsAt);
}

export function expectedCloseAt(round: RoundRow, schedule: ScheduledEntry[]): number {
  if (round.close_at !== null) return round.close_at;
  const last = schedule[schedule.length - 1];
  if (!last) return round.opened_at + MIN_OPEN_MS;
  return Math.max(round.opened_at + MIN_OPEN_MS, last.status === 'playing' ? last.scheduledStart : last.scheduledStart + 10_000);
}

export function closeDue(round: RoundRow, schedule: ScheduledEntry[], now: number): boolean {
  if (round.close_at !== null) return now >= round.close_at;
  if (now - round.opened_at < MIN_OPEN_MS) return false;
  const last = schedule[schedule.length - 1];
  if (!last) return true;
  if (last.status === 'playing') return true;
  return now >= last.scheduledStart + 10_000;
}

async function poolForSet(db: D1Database, setId: number, settings: Settings, excludeRoundId: number | null) {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.duration_ms, COALESCE(s.mood_level, st.default_level) AS level,
              w.id AS wish_id, (SELECT COUNT(*) FROM wish_upvotes u WHERE u.wish_id = w.id) AS upvotes
       FROM set_songs ss
       JOIN songs s ON s.id = ss.song_id
       JOIN sets st ON st.id = ss.set_id
       LEFT JOIN wishes w ON w.song_id = s.id AND w.status = 'approved'
       WHERE ss.set_id = ?1
         AND s.active = 1
         AND (?2 = 1 OR s.explicit = 0)
         AND NOT EXISTS (
           SELECT 1 FROM playback p WHERE p.song_id = s.id AND p.status NOT IN ('missed', 'cancelled')
         )
         AND NOT EXISTS (SELECT 1 FROM round_candidates rc WHERE rc.round_id = ?3 AND rc.song_id = s.id)`,
    )
    .bind(setId, settings.voting.allowExplicit ? 1 : 0, excludeRoundId ?? -1)
    .all<PoolSong>();
  return results;
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function pickCandidates(pool: PoolSong[], level: number, settings: Settings): PoolSong[] {
  const atLevel = pool.filter((s) => s.level === level);
  const wishes = atLevel.filter((s) => s.wish_id !== null).sort((a, b) => b.upvotes - a.upvotes);
  const rest = shuffle(atLevel.filter((s) => s.wish_id === null));
  const minMs = settings.voting.minRoundMinutes * MINUTE + CANDIDATE_BUFFER_MS;
  const picked: PoolSong[] = [];
  let total = 0;
  for (const song of [...wishes, ...rest]) {
    if (picked.length >= MAX_CANDIDATES) break;
    if (picked.length >= settings.voting.candidatesPerRound && total >= minMs) break;
    picked.push(song);
    total += song.duration_ms;
  }
  return picked;
}

function levelAvailable(pool: PoolSong[], level: number, settings: Settings): boolean {
  const songs = pool.filter((s) => s.level === level);
  const total = songs.reduce((sum, s) => sum + s.duration_ms, 0);
  return songs.length >= 3 && total >= settings.voting.minRoundMinutes * MINUTE + 4 * MINUTE;
}

export interface RoundDraft {
  level: number;
  target: number;
  constrained: boolean;
  set: SetRow | null;
  candidates: PoolSong[];
}

export async function draftRound(
  db: D1Database,
  settings: Settings,
  previousLevel: number,
  expectedPlayAt: number,
  excludeRoundId: number | null,
): Promise<RoundDraft> {
  const sets = await listSets(db);
  const set = setActiveAt(sets, expectedPlayAt);
  const pool = set ? await poolForSet(db, set.id, settings, excludeRoundId) : [];
  const plan = planLevel({
    previousLevel,
    maxStep: settings.voting.maxMoodStep,
    overrideTarget: settings.nextRound.levelOverride,
    sets,
    expectedPlayAt,
    roundMs: settings.voting.minRoundMinutes * MINUTE + 2 * MINUTE,
    isAvailable: (level) => levelAvailable(pool, level, settings),
  });
  return { ...plan, set, candidates: pickCandidates(pool, plan.level, settings) };
}

function candidateStatements(
  db: D1Database,
  roundSeq: number,
  candidates: PoolSong[],
  guard: { token: string; closingRoundId: number } | null,
  openToken: string,
) {
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < candidates.length; i += 15) {
    const rows = candidates.slice(i, i + 15);
    const values = rows.map((_, r) => `(?${r * 4 + 4}, ?${r * 4 + 5}, ?${r * 4 + 6}, ?${r * 4 + 7})`).join(', ');
    const params = rows.flatMap((c, r) => [c.id, i + r + 1, randomInt(1_000_000_000), c.wish_id]);
    const condition = guard
      ? 'EXISTS (SELECT 1 FROM rounds WHERE id = ?2 AND close_token = ?3)'
      : "EXISTS (SELECT 1 FROM rounds WHERE seq = ?1 AND status = 'open' AND close_token = ?3)";
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO round_candidates (round_id, song_id, position, tiebreak, wish_id)
           SELECT (SELECT id FROM rounds WHERE seq = ?1), v.column1, v.column2, v.column3, v.column4
           FROM (VALUES ${values}) AS v
           WHERE ${condition}`,
        )
        .bind(roundSeq, guard?.closingRoundId ?? -1, guard?.token ?? openToken, ...params),
    );
  }
  return statements;
}

export async function startFirstRound(
  db: D1Database,
  settings: Settings,
  now: number,
  snapshot: StoredSnapshot | null,
): Promise<boolean> {
  const previous = await lastRound(db);
  const schedule = computeSchedule(await activeEntries(db), now, snapshot);
  const lastScheduled = schedule[schedule.length - 1];
  const expectedPlayAt = (lastScheduled?.scheduledEnd ?? now) + settings.voting.firstRoundMinutes * MINUTE;
  const draft = await draftRound(db, settings, previous?.mood_level ?? settings.preshow.level, expectedPlayAt, null);
  const seq = (previous?.seq ?? 0) + 1;
  const closeAt = lastScheduled ? null : now + settings.voting.firstRoundMinutes * MINUTE;
  const token = randomToken(12);
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO rounds (seq, status, mood_level, set_id, opened_at, close_at, close_token)
         SELECT ?1, 'open', ?2, ?3, ?4, ?5, ?6
         WHERE NOT EXISTS (SELECT 1 FROM rounds WHERE status = 'open')
         ON CONFLICT DO NOTHING`,
      )
      .bind(seq, draft.level, draft.set?.id ?? null, now, closeAt, token),
    ...candidateStatements(db, seq, draft.candidates, null, token),
  ]);
  return (results[0]?.meta.changes ?? 0) === 1;
}

export interface FinalizeOptions {
  createNext: boolean;
  anchorAt: number;
  skip?: boolean;
}

export async function finalizeRound(
  db: D1Database,
  settings: Settings,
  round: RoundRow,
  now: number,
  options: FinalizeOptions,
): Promise<boolean> {
  const token = randomToken(12);
  const minMs = settings.voting.minRoundMinutes * MINUTE;
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE rounds SET status = ?2, closed_at = ?3, close_token = ?4, anchor_at = ?5
         WHERE id = ?1 AND status = 'open'`,
      )
      .bind(round.id, options.skip ? 'skipped' : 'closed', now, token, options.anchorAt),
  ];
  if (!options.skip) {
    statements.push(
      db
        .prepare(
          `INSERT INTO playback (seq, round_id, song_id, source, position, votes, status, created_at)
           SELECT ?3 * 1000 + rn * 10, ?1, song_id, 'winner', rn, votes, 'planned', ?4
           FROM (
             SELECT song_id, votes, rn,
                    SUM(duration_ms) OVER (ORDER BY rn ROWS BETWEEN UNBOUNDED PRECEDING AND 2 PRECEDING) AS before_previous
             FROM (
               SELECT c.song_id, s.duration_ms, COALESCE(v.cnt, 0) AS votes,
                      ROW_NUMBER() OVER (
                        ORDER BY COALESCE(v.cnt, 0) DESC, COALESCE(u.cnt, 0) DESC, COALESCE(v.first_at, 9000000000000000) ASC, c.tiebreak ASC
                      ) AS rn
               FROM round_candidates c
               JOIN songs s ON s.id = c.song_id
               LEFT JOIN (
                 SELECT song_id, COUNT(*) AS cnt, MIN(updated_at) AS first_at
                 FROM votes WHERE round_id = ?1 AND invalidated = 0 GROUP BY song_id
               ) v ON v.song_id = c.song_id
               LEFT JOIN (SELECT wish_id, COUNT(*) AS cnt FROM wish_upvotes GROUP BY wish_id) u ON u.wish_id = c.wish_id
               WHERE c.round_id = ?1 AND s.active = 1
             )
           )
           WHERE COALESCE(before_previous, 0) < ?5
             AND EXISTS (SELECT 1 FROM rounds WHERE id = ?1 AND close_token = ?2)`,
        )
        .bind(round.id, token, round.seq, now, minMs),
      db
        .prepare(
          `UPDATE wishes SET status = 'played'
           WHERE status = 'approved'
             AND song_id IN (SELECT song_id FROM playback WHERE round_id = ?1)
             AND EXISTS (SELECT 1 FROM rounds WHERE id = ?1 AND close_token = ?2)`,
        )
        .bind(round.id, token),
    );
  }
  if (options.createNext) {
    const nextSeq = round.seq + 1;
    const expectedPlayAt = options.anchorAt + minMs + 2 * MINUTE;
    const draft = await draftRound(db, settings, round.mood_level, expectedPlayAt, round.id);
    statements.push(
      db
        .prepare(
          `INSERT INTO rounds (seq, status, mood_level, set_id, opened_at, close_at)
           SELECT ?1, 'open', ?2, ?3, ?4,
                  CASE WHEN EXISTS (
                    SELECT 1 FROM playback WHERE status IN ('planned', 'queuing', 'queued', 'unknown', 'playing')
                  ) THEN NULL ELSE ?4 + ?5 END
           WHERE EXISTS (SELECT 1 FROM rounds WHERE id = ?6 AND close_token = ?7)
           ON CONFLICT DO NOTHING`,
        )
        .bind(nextSeq, draft.level, draft.set?.id ?? null, now, minMs, round.id, token),
      ...candidateStatements(db, nextSeq, draft.candidates, { token, closingRoundId: round.id }, token),
    );
  }
  const results = await db.batch(statements);
  return (results[0]?.meta.changes ?? 0) === 1;
}

export interface TallyRow {
  song_id: number;
  votes: number;
}

export async function tally(db: D1Database, roundId: number): Promise<TallyRow[]> {
  const { results } = await db
    .prepare(
      `SELECT c.song_id, COUNT(v.device_id) AS votes
       FROM round_candidates c
       LEFT JOIN votes v ON v.round_id = c.round_id AND v.song_id = c.song_id AND v.invalidated = 0
       WHERE c.round_id = ?1
       GROUP BY c.song_id`,
    )
    .bind(roundId)
    .all<TallyRow>();
  return results;
}
