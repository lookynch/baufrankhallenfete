import type { Settings } from '../../shared/settings.ts';
import type { Runtime } from '../env.ts';
import { pruneRateLimits } from '../security/ratelimit.ts';
import { jukeboxOpen, markPlayedWishes, planJukeboxWish } from './jukebox.ts';
import { getKv, setKv, tryLock } from './kv.ts';
import {
  activeEntries,
  computeSchedule,
  expireStale,
  nextTickAt,
  queueNext,
  reconcile,
  type StoredSnapshot,
} from './playback.ts';

export type { StoredSnapshot };
import { closeDue, expectedCloseAt, finalizeRound, openRound, startFirstRound, votingActive } from './rounds.ts';
import { loadSettings } from './settings.ts';

const SNAPSHOT_KEY = 'spotify_snapshot';
const SNAPSHOT_INTERVAL_MS = 4_500;
const ISOLATE_TICK_INTERVAL_MS = 2_000;

let lastIsolateTick = 0;

export async function readSnapshot(db: D1Database): Promise<StoredSnapshot | null> {
  return (await getKv<StoredSnapshot>(db, SNAPSHOT_KEY))?.value ?? null;
}

async function refreshSnapshot(rt: Runtime, now: number): Promise<StoredSnapshot | null> {
  if (!(await tryLock(rt.env.DB, 'spotify_poll', now, SNAPSHOT_INTERVAL_MS))) return null;
  const result = await rt.spotify.currentlyPlaying();
  const stored: StoredSnapshot = result.ok
    ? { fetchedAt: now, snapshot: result.value, error: null }
    : { fetchedAt: now, snapshot: null, error: result.kind };
  await setKv(rt.env.DB, SNAPSHOT_KEY, stored, now);
  return stored;
}

export async function tick(rt: Runtime, options: { force?: boolean } = {}): Promise<void> {
  const now = rt.now();
  if (!options.force && now - lastIsolateTick < ISOLATE_TICK_INTERVAL_MS) return;
  lastIsolateTick = now;
  const db = rt.env.DB;
  const settings = await loadSettings(db, now);

  const fresh = await refreshSnapshot(rt, now);
  const votingSince = votingActive(settings, now) ? settings.voting.startsAt : null;
  if (fresh?.snapshot) await reconcile(db, rt.spotify, fresh.snapshot, fresh.fetchedAt, votingSince);
  const snapshot = fresh ?? (await readSnapshot(db));
  await expireStale(db, now, snapshot);
  await markPlayedWishes(db);
  await advanceRounds(rt, settings, now, snapshot);
  if (jukeboxOpen(settings, snapshot, now, rt.lastfm !== null)) await planJukeboxWish(db, settings, now);
  await queueNext(db, rt.spotify, now);

  if (await tryLock(db, 'prune', now, 3_600_000)) await pruneRateLimits(db, now);
}

function anchorFor(snapshot: StoredSnapshot | null, now: number, scheduleEnd: number | null): number {
  if (scheduleEnd !== null && scheduleEnd > now) return scheduleEnd;
  const track = snapshot?.snapshot?.track;
  if (snapshot?.snapshot?.isPlaying && track) {
    const elapsedSinceFetch = now - snapshot.fetchedAt;
    const remaining = track.durationMs - snapshot.snapshot.progressMs - elapsedSinceFetch;
    if (remaining > 0 && remaining < track.durationMs) return now + remaining;
  }
  return now;
}

export async function advanceRounds(
  rt: Runtime,
  settings: Settings,
  now: number,
  snapshot: StoredSnapshot | null,
): Promise<void> {
  const db = rt.env.DB;
  const round = await openRound(db);
  if (!round) {
    if (votingActive(settings, now)) await startFirstRound(db, settings, now, snapshot);
    return;
  }
  const schedule = computeSchedule(await activeEntries(db), now, snapshot);
  if (!closeDue(round, schedule, now)) return;
  const last = schedule[schedule.length - 1];
  await finalizeRound(db, settings, round, now, {
    createNext: votingActive(settings, now),
    anchorAt: anchorFor(snapshot, now, last ? last.scheduledEnd : null),
  });
}

export async function upcomingTick(db: D1Database, now: number): Promise<number | null> {
  const round = await openRound(db);
  const schedule = computeSchedule(await activeEntries(db), now, await readSnapshot(db));
  return nextTickAt(schedule, round ? expectedCloseAt(round, schedule) : null, now);
}
