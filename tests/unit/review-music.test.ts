import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../../src/server/http.ts';
import { musicRoutes } from '../../src/server/routes/admin/music.ts';
import type { AdminPrincipal } from '../../src/server/security/session.ts';
import { planLevel } from '../../src/server/services/levels.ts';
import { importTracks, saveSet, setCoverage } from '../../src/server/services/library.ts';
import { activeEntries, computeSchedule } from '../../src/server/services/playback.ts';
import {
  closeDue,
  draftRound,
  expectedCloseAt,
  finalizeRound,
  openRound,
  type RoundRow,
} from '../../src/server/services/rounds.ts';
import { loadSettings, saveSettings } from '../../src/server/services/settings.ts';
import { readSnapshot, tick } from '../../src/server/services/tick.ts';
import type { SpotifyTrack } from '../../src/server/services/spotify-api.ts';
import { FakeSpotify, makeTrack } from '../helpers/fake-spotify.ts';
import { Clock, testEnv, testRuntime } from '../helpers/runtime.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const T0 = Date.UTC(2026, 10, 20, 17, 0, 0);

interface SetSpec {
  name: string;
  from: number;
  to: number;
  level: number;
  songs: Array<{ prefix: string; count: number; level: number | null }>;
}

async function party(sets: SetSpec[], votingStartsAt = T0) {
  const clock = new Clock(T0);
  const env = testEnv();
  const db = env.DB;
  const spotify = new FakeSpotify(clock.now);
  const rt = testRuntime(env, clock, spotify);
  await saveSettings(db, 'event', { startsAt: T0, endsAt: T0 + 10 * HOUR }, T0, null);
  await saveSettings(db, 'voting', { startsAt: votingStartsAt, endsAt: null, enabled: true }, T0, null);
  await saveSettings(db, 'preshow', { playlistUri: 'spotify:playlist:preshow123', level: 2 }, T0, null);
  for (const spec of sets) {
    const setId = await saveSet(
      db,
      { name: spec.name, starts_at: T0 + spec.from, ends_at: T0 + spec.to, default_level: spec.level as 1 },
      T0,
    );
    for (const group of spec.songs) {
      const tracks: SpotifyTrack[] = [];
      for (let i = 0; i < group.count; i++) {
        const track = makeTrack(i, 200_000 + (i % 7) * 10_000, group.prefix);
        tracks.push(track);
        spotify.add(track);
      }
      for (let i = 0; i < tracks.length; i += 50) await importTracks(db, tracks.slice(i, i + 50), setId, T0);
      if (group.level !== null) {
        await db
          .prepare('UPDATE songs SET mood_level = ?1 WHERE spotify_uri LIKE ?2')
          .bind(group.level, `spotify:track:${group.prefix}%`)
          .run();
      }
    }
  }
  for (let i = 0; i < 30; i++) {
    const track = makeTrack(i, 200_000, 'pre');
    spotify.add(track);
    spotify.context.push(track.uri);
  }
  await spotify.startContext('spotify:playlist:preshow123');
  const step = async (ms = 5_000) => {
    await tick(rt, { force: true });
    await rt.settle();
    clock.advance(ms);
  };
  const runFor = async (ms: number) => {
    const end = clock.time + ms;
    while (clock.time < end) await step();
  };
  return { clock, env, db, spotify, rt, step, runFor };
}

const warmup: SetSpec = {
  name: 'Warm-up',
  from: 0,
  to: 8 * HOUR,
  level: 2,
  songs: [{ prefix: 'wa', count: 120, level: null }],
};

function adminApp(harness: Awaited<ReturnType<typeof party>>) {
  const app = new Hono<AppEnv>();
  app.use(async (c, next) => {
    c.set('rt', harness.rt);
    c.set('admin', { userId: 1, username: 'dj', displayName: 'DJ', role: 'owner' } as AdminPrincipal);
    await next();
  });
  app.route('/', musicRoutes);
  return (path: string, json?: unknown) =>
    app.request(
      path,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json === undefined ? undefined : JSON.stringify(json),
      },
      harness.env,
    );
}

async function statusCounts(db: D1Database) {
  const { results } = await db
    .prepare('SELECT status, COUNT(*) AS n FROM playback GROUP BY status')
    .all<{ status: string; n: number }>();
  return Object.fromEntries(results.map((r) => [r.status, r.n]));
}

describe('Wiedergabe bei Pause in Spotify (#2)', () => {
  it('reiht nach einer langen Pause nichts doppelt ein und markiert nichts als verpasst', async () => {
    const harness = await party([warmup]);
    const { db, spotify } = harness;
    let ready = false;
    for (let i = 0; i < 2_000 && !ready; i++) {
      await harness.step();
      const counts = await statusCounts(db);
      ready = (counts.playing ?? 0) === 1 && (counts.queued ?? 0) === 1 && (counts.planned ?? 0) >= 1;
    }
    expect(ready).toBe(true);
    const before = await activeEntries(db);
    const playing = before.find((e) => e.status === 'playing')!;
    const queued = before.find((e) => e.status === 'queued')!;

    spotify.pause();
    const addToQueue = vi.spyOn(spotify, 'addToQueue');
    await harness.runFor(playing.duration_ms + 10 * MINUTE);
    expect(addToQueue).not.toHaveBeenCalled();
    const during = await activeEntries(db);
    expect(during.find((e) => e.id === playing.id)?.status).toBe('playing');
    expect(during.find((e) => e.id === queued.id)?.status).toBe('queued');
    expect((await statusCounts(db)).missed ?? 0).toBe(0);

    spotify.resume();
    await harness.runFor(45 * MINUTE);
    const queuedPlays = spotify.log.filter((e) => e.source === 'queue');
    expect(new Set(queuedPlays.map((e) => e.uri)).size).toBe(queuedPlays.length);
    expect(spotify.maxQueueLength).toBeLessThanOrEqual(1);
    const emergencies = await db
      .prepare("SELECT COUNT(*) AS n FROM observed_plays WHERE kind = 'emergency'")
      .first<{ n: number }>();
    expect(emergencies?.n).toBe(0);
  });
});

describe('Stimmungsplanung am Set-Wechsel (#3, #11)', () => {
  it('weicht bei gleichem Ziel auch nach unten aus', () => {
    const sets = [{ id: 1, name: 'Peak', starts_at: 0, ends_at: 4 * HOUR, default_level: 5 }];
    const base = { maxStep: 1, overrideTarget: null, sets, roundMs: 20 * MINUTE, expectedPlayAt: HOUR };
    expect(planLevel({ ...base, previousLevel: 5, isAvailable: (l) => l === 4 })).toMatchObject({
      level: 4,
      matched: true,
    });
    expect(planLevel({ ...base, previousLevel: 3, overrideTarget: 3, isAvailable: (l) => l === 2 }).level).toBe(2);
    expect(planLevel({ ...base, previousLevel: 5, isAvailable: () => false }).matched).toBe(false);
  });

  it('erzeugt nach dem Set-Wechsel weiter Runden mit Kandidaten, ohne Stufensprung', async () => {
    const harness = await party([
      { ...warmup, to: 1.5 * HOUR },
      { name: 'Party', from: 1.5 * HOUR, to: 8 * HOUR, level: 4, songs: [{ prefix: 'pa', count: 80, level: null }] },
    ]);
    await harness.runFor(3 * HOUR);
    const { results: rounds } = await harness.db
      .prepare(
        `SELECT r.seq, r.mood_level, (SELECT COUNT(*) FROM round_candidates c WHERE c.round_id = r.id) AS candidates
         FROM rounds r ORDER BY r.seq`,
      )
      .all<{ seq: number; mood_level: number; candidates: number }>();
    expect(rounds.length).toBeGreaterThan(6);
    for (const round of rounds) expect(round.candidates).toBeGreaterThan(0);
    for (let i = 1; i < rounds.length; i++) {
      expect(Math.abs(rounds[i]!.mood_level - rounds[i - 1]!.mood_level)).toBeLessThanOrEqual(1);
    }
    const lateQueued = harness.spotify.log.filter((e) => e.source === 'queue' && e.startedAt > T0 + 2 * HOUR);
    expect(lateQueued.length).toBeGreaterThan(5);
  });

  it('meldet fehlende Zwischenstufen zwischen zwei Sets in der Abdeckung', async () => {
    const harness = await party([
      { ...warmup, to: 1.5 * HOUR, songs: [{ prefix: 'wa', count: 40, level: null }] },
      { name: 'Party', from: 1.5 * HOUR, to: 3 * HOUR, level: 4, songs: [{ prefix: 'pa', count: 40, level: null }] },
    ]);
    const [first, second] = await setCoverage(harness.db, { maxMoodStep: 1, minRoundMinutes: 17 });
    expect(first?.rampOk).toBe(true);
    expect(second).toMatchObject({ rampOk: false, ok: false });
    await harness.db.prepare("UPDATE songs SET mood_level = 3 WHERE spotify_uri LIKE 'spotify:track:pa00000%'").run();
    const [, fixed] = await setCoverage(harness.db, { maxMoodStep: 1, minRoundMinutes: 17 });
    expect(fixed?.rampOk).toBe(true);
  });

  it('greift auf Songs anderer Sets zurück, bevor die Stufenregel verletzt wird', async () => {
    const harness = await party([
      { name: 'Früh', from: 0, to: HOUR, level: 3, songs: [{ prefix: 'fa', count: 20, level: null }] },
      { name: 'Mitte', from: HOUR, to: 2 * HOUR, level: 5, songs: [{ prefix: 'ma', count: 20, level: null }] },
      { name: 'Spät', from: 2 * HOUR, to: 8 * HOUR, level: 5, songs: [{ prefix: 'sa', count: 20, level: null }] },
    ]);
    const settings = await loadSettings(harness.db, T0);
    const draft = await draftRound(harness.db, settings, 3, T0 + 3 * HOUR, null);
    expect(draft).toMatchObject({ level: 3, matched: true });
    expect(draft.candidates.length).toBeGreaterThan(0);
  });

  it('bevorzugt eine gut bestückte Nachbarstufe vor einer fast leeren Zielstufe', async () => {
    const harness = await party([
      {
        name: 'Peak',
        from: 0,
        to: 8 * HOUR,
        level: 5,
        songs: [
          { prefix: 'pk', count: 2, level: 5 },
          { prefix: 'pn', count: 28, level: 4 },
        ],
      },
    ]);
    const settings = await loadSettings(harness.db, T0);
    const draft = await draftRound(harness.db, settings, 5, T0 + HOUR, null);
    expect(draft).toMatchObject({ level: 4, matched: true });
    const total = draft.candidates.reduce((sum, s) => sum + s.duration_ms, 0);
    expect(total).toBeGreaterThanOrEqual(settings.voting.minRoundMinutes * MINUTE);
    expect(draft.candidates.every((s) => s.level === 4)).toBe(true);
  });

  it('wählt nur im Notfall eine weiter entfernte Stufe, statt eine leere Runde zu öffnen', async () => {
    const harness = await party([
      { name: 'Party', from: 0, to: 8 * HOUR, level: 4, songs: [{ prefix: 'pa', count: 20, level: null }] },
    ]);
    const settings = await loadSettings(harness.db, T0);
    const draft = await draftRound(harness.db, settings, 2, T0 + 20 * MINUTE, null);
    expect(draft).toMatchObject({ level: 4, matched: false });
    expect(draft.candidates.length).toBeGreaterThan(0);
  });
});

describe('Mindest-Abstimmzeit (#12, #13)', () => {
  it('hält die erste Runde trotz manuell eingeplantem Song mindestens firstRoundMinutes offen', async () => {
    const harness = await party([warmup], T0 + 2 * MINUTE);
    await harness.db
      .prepare(
        `INSERT INTO playback (seq, round_id, song_id, source, position, status, created_at)
         VALUES (1, NULL, (SELECT id FROM songs ORDER BY id LIMIT 1), 'manual', 0, 'planned', ?1)`,
      )
      .bind(T0)
      .run();
    await harness.runFor(30 * MINUTE);
    const first = await harness.db
      .prepare('SELECT opened_at, closed_at, min_close_at FROM rounds WHERE seq = 1')
      .first<{ opened_at: number; closed_at: number | null; min_close_at: number }>();
    expect(first?.closed_at).not.toBeNull();
    expect(first!.closed_at! - first!.opened_at).toBeGreaterThanOrEqual(17 * MINUTE);
    expect(first?.min_close_at).toBe(first!.opened_at + 17 * MINUTE);
  });

  it('closeDue und expectedCloseAt respektieren min_close_at auch ohne Plan', () => {
    const round: RoundRow = {
      id: 1,
      seq: 2,
      status: 'open',
      mood_level: 2,
      set_id: null,
      opened_at: T0,
      close_at: null,
      min_close_at: T0 + 20 * MINUTE,
      closed_at: null,
      anchor_at: null,
    };
    expect(closeDue(round, [], T0 + 19 * MINUTE)).toBe(false);
    expect(closeDue(round, [], T0 + 20 * MINUTE)).toBe(true);
    expect(expectedCloseAt(round, [])).toBe(T0 + 20 * MINUTE);
    const legacy = { ...round, min_close_at: null, close_at: T0 + 5 * MINUTE };
    expect(closeDue(legacy, [], T0 + 16 * MINUTE)).toBe(false);
    expect(expectedCloseAt(legacy, [])).toBe(T0 + 17 * MINUTE);
  });

  it('lässt nach Überspringen oder Stornieren keine Runde kürzer als minRoundMinutes laufen', async () => {
    const harness = await party([warmup]);
    const post = adminApp(harness);
    await harness.runFor(50 * MINUTE);
    const skipped = await post('/rounds/skip');
    expect(skipped.status).toBe(200);
    const { results: planned } = await harness.db
      .prepare("SELECT id FROM playback WHERE status = 'planned'")
      .all<{ id: number }>();
    for (const entry of planned) expect((await post(`/playback/${entry.id}/cancel`)).status).toBe(200);
    await harness.runFor(90 * MINUTE);
    const { results: rounds } = await harness.db
      .prepare("SELECT seq, opened_at, closed_at FROM rounds WHERE status = 'closed' ORDER BY seq")
      .all<{ seq: number; opened_at: number; closed_at: number }>();
    expect(rounds.length).toBeGreaterThan(3);
    for (const round of rounds) expect(round.closed_at - round.opened_at).toBeGreaterThanOrEqual(17 * MINUTE);
  });

  it('plant ein vorzeitiges Beenden durch den Admin auf das frühestmögliche Ende', async () => {
    const harness = await party([warmup]);
    const post = adminApp(harness);
    await harness.runFor(5 * MINUTE);
    const round = (await openRound(harness.db))!;
    const response = await post('/rounds/close');
    expect(await response.json()).toEqual({ ok: true, closeAt: round.opened_at + 17 * MINUTE });
    expect((await openRound(harness.db))?.id).toBe(round.id);
    await harness.runFor(13 * MINUTE);
    const closed = await harness.db
      .prepare('SELECT status, closed_at FROM rounds WHERE id = ?1')
      .bind(round.id)
      .first<{ status: string; closed_at: number }>();
    expect(closed?.status).toBe('closed');
    expect(closed!.closed_at - round.opened_at).toBeGreaterThanOrEqual(17 * MINUTE);
  });
});

describe('Admin-Eingriffe in Runden und Wiedergabe (#30, #31)', () => {
  it('startet nach Ende des Votings keine neue Runde, wenn der Admin schließt oder überspringt', async () => {
    for (const action of ['close', 'skip']) {
      const harness = await party([warmup]);
      const post = adminApp(harness);
      await harness.runFor(20 * MINUTE);
      const now = harness.clock.time;
      await harness.db
        .prepare("UPDATE rounds SET opened_at = ?1, min_close_at = ?2, close_at = NULL WHERE status = 'open'")
        .bind(now - 18 * MINUTE, now - MINUTE)
        .run();
      await saveSettings(harness.db, 'voting', { enabled: false }, now, null);
      expect((await post(`/rounds/${action}`)).status).toBe(200);
      expect(await openRound(harness.db)).toBeNull();
    }
  });

  it('lehnt manuelles Einplanen von bereits geplanten oder zur Wahl stehenden Songs ab', async () => {
    const harness = await party([warmup]);
    const post = adminApp(harness);
    await harness.runFor(20 * MINUTE);
    const round = (await openRound(harness.db))!;
    const candidate = await harness.db
      .prepare('SELECT song_id FROM round_candidates WHERE round_id = ?1 LIMIT 1')
      .bind(round.id)
      .first<{ song_id: number }>();
    const planned = await harness.db
      .prepare("SELECT song_id FROM playback WHERE status IN ('planned', 'queued', 'playing') LIMIT 1")
      .first<{ song_id: number }>();
    const free = await harness.db
      .prepare(
        `SELECT id FROM songs s WHERE NOT EXISTS (SELECT 1 FROM playback p WHERE p.song_id = s.id)
           AND NOT EXISTS (SELECT 1 FROM round_candidates c WHERE c.song_id = s.id) LIMIT 1`,
      )
      .first<{ id: number }>();

    const asCandidate = await post('/playback/insert', { songId: candidate!.song_id });
    expect(asCandidate.status).toBe(409);
    expect(await asCandidate.json()).toEqual({ error: 'song_is_round_candidate' });
    const asPlanned = await post('/playback/insert', { songId: planned!.song_id });
    expect(asPlanned.status).toBe(409);
    expect(await asPlanned.json()).toEqual({ error: 'song_already_scheduled' });
    expect((await post('/playback/insert', { songId: 999_999 })).status).toBe(404);
    expect((await post('/playback/insert', { songId: free!.id })).status).toBe(200);
  });

  it('plant einen Gewinner nicht erneut ein, wenn er bereits in der Wiedergabe steht', async () => {
    const harness = await party([warmup]);
    await harness.runFor(5 * MINUTE);
    const round = (await openRound(harness.db))!;
    const { results: candidates } = await harness.db
      .prepare('SELECT song_id FROM round_candidates WHERE round_id = ?1 ORDER BY position')
      .bind(round.id)
      .all<{ song_id: number }>();
    await harness.db
      .prepare(
        `INSERT INTO playback (seq, round_id, song_id, source, position, status, created_at)
         VALUES (500, NULL, ?1, 'manual', 0, 'played', ?2)`,
      )
      .bind(candidates[0]!.song_id, harness.clock.time)
      .run();
    await harness.db
      .prepare(
        `INSERT INTO votes (round_id, device_id, song_id, ip_key, verified, created_at, updated_at)
         VALUES (?1, 'device-1', ?2, 'ip-1', 1, ?3, ?3)`,
      )
      .bind(round.id, candidates[0]!.song_id, harness.clock.time)
      .run();
    const settings = await loadSettings(harness.db, harness.clock.time);
    const schedule = computeSchedule(
      await activeEntries(harness.db),
      harness.clock.time,
      await readSnapshot(harness.db),
    );
    await finalizeRound(harness.db, settings, round, harness.clock.time, {
      createNext: false,
      anchorAt: schedule.at(-1)?.scheduledEnd ?? harness.clock.time,
    });
    const rows = await harness.db
      .prepare('SELECT COUNT(*) AS n FROM playback WHERE song_id = ?1')
      .bind(candidates[0]!.song_id)
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);
    const winners = await harness.db
      .prepare('SELECT COUNT(*) AS n FROM playback WHERE round_id = ?1')
      .bind(round.id)
      .first<{ n: number }>();
    expect(winners?.n).toBeGreaterThan(0);
  });
});
