import { describe, expect, it } from 'vitest';
import { MIN_VOTING_MINUTES } from '../../src/shared/settings.ts';
import { importTracks, saveSet } from '../../src/server/services/library.ts';
import { openRound } from '../../src/server/services/rounds.ts';
import { loadSettings, saveSettings } from '../../src/server/services/settings.ts';
import { tick } from '../../src/server/services/tick.ts';
import { castVote } from '../../src/server/services/votes.ts';
import type { SpotifyTrack } from '../../src/server/services/spotify-api.ts';
import { FakeSpotify, makeTrack } from '../helpers/fake-spotify.ts';
import { Clock, testEnv, testRuntime } from '../helpers/runtime.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const T0 = Date.UTC(2026, 10, 20, 17, 0, 0);

function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

interface Scenario {
  hours: number;
  spotifyOutage?: { from: number; to: number };
  votesPerRound?: number;
  tvOffline?: boolean;
}

async function runEvening(scenario: Scenario) {
  const clock = new Clock(T0);
  const env = testEnv();
  const db = env.DB;
  const spotify = new FakeSpotify(clock.now);
  const rt = testRuntime(env, clock, spotify);
  const random = seededRandom(42);

  await saveSettings(db, 'event', { startsAt: T0, endsAt: T0 + scenario.hours * HOUR }, T0, null);
  await saveSettings(db, 'voting', { startsAt: T0 + 30 * MINUTE }, T0, null);
  await saveSettings(db, 'preshow', { playlistUri: 'spotify:playlist:preshow123', level: 2 }, T0, null);

  const warmup = await saveSet(db, { name: 'Warm-up', starts_at: T0, ends_at: T0 + 2.5 * HOUR, default_level: 2 }, T0);
  const party = await saveSet(db, { name: 'Party', starts_at: T0 + 2.5 * HOUR, ends_at: T0 + 8 * HOUR, default_level: 4 }, T0);

  const levelByUri = new Map<string, number>();
  const addSongs = async (setId: number, prefix: string, count: number, level: number | null, defaultLevel: number) => {
    const tracks: SpotifyTrack[] = [];
    for (let i = 0; i < count; i++) {
      const track = makeTrack(i, Math.round(150_000 + random() * 150_000), prefix);
      tracks.push(track);
      spotify.add(track);
      levelByUri.set(track.uri, level ?? defaultLevel);
    }
    for (let i = 0; i < tracks.length; i += 50) await importTracks(db, tracks.slice(i, i + 50), setId, T0);
    if (level !== null) {
      await db
        .prepare(`UPDATE songs SET mood_level = ?1 WHERE spotify_uri LIKE ?2`)
        .bind(level, `spotify:track:${prefix}%`)
        .run();
    }
  };
  await addSongs(warmup, 'wa', 60, null, 2);
  await addSongs(warmup, 'wb', 40, 3, 2);
  await addSongs(warmup, 'wc', 20, 1, 2);
  await addSongs(party, 'pa', 70, null, 4);
  await addSongs(party, 'pb', 40, 3, 4);
  await addSongs(party, 'pc', 40, 5, 4);

  for (let i = 0; i < 30; i++) {
    const track = makeTrack(i, 200_000, 'pre');
    spotify.add(track);
    spotify.context.push(track.uri);
  }
  await spotify.startContext('spotify:playlist:preshow123');

  const end = T0 + scenario.hours * HOUR;
  let lastVoteRound = 0;
  while (clock.time < end) {
    const outage = scenario.spotifyOutage;
    spotify.offline = Boolean(outage && clock.time >= T0 + outage.from && clock.time < T0 + outage.to);
    await tick(rt, { force: true });
    await rt.settle();
    const round = await openRound(db);
    if (round && round.id !== lastVoteRound && clock.time - round.opened_at > 2 * MINUTE) {
      lastVoteRound = round.id;
      const { results } = await db
        .prepare('SELECT song_id FROM round_candidates WHERE round_id = ?1')
        .bind(round.id)
        .all<{ song_id: number }>();
      const settings = await loadSettings(db, clock.time);
      for (let v = 0; v < (scenario.votesPerRound ?? 40); v++) {
        const pick = results[Math.floor(random() * Math.min(4, results.length))]!;
        await castVote(db, settings, {
          roundId: round.id,
          songId: pick.song_id,
          deviceId: `device-${v}`,
          ipKey: `ip-${v}`,
          ipFamily: 'v6',
          verified: true,
          fpHash: null,
          now: clock.time,
        });
      }
    }
    clock.advance(scenario.tvOffline ? 20_000 : 5_000);
  }
  return { db, spotify, levelByUri };
}

describe('Abendsimulation', () => {
  it('spielt nach dem Vorprogramm nur Gewinner, ohne Stau, mit sanften Übergängen und ohne Wiederholung', async () => {
    const { db, spotify, levelByUri } = await runEvening({ hours: 6 });

    const queued = spotify.log.filter((e) => e.source === 'queue');
    expect(queued.length).toBeGreaterThan(60);
    const firstQueued = spotify.log.findIndex((e) => e.source === 'queue');
    const afterFirst = spotify.log.slice(firstQueued);
    expect(afterFirst.filter((e) => e.source === 'context')).toEqual([]);

    expect(spotify.maxQueueLength).toBeLessThanOrEqual(1);
    expect(new Set(queued.map((e) => e.uri)).size).toBe(queued.length);

    const levels = queued.map((e) => levelByUri.get(e.uri)!);
    for (let i = 1; i < levels.length; i++) expect(Math.abs(levels[i]! - levels[i - 1]!)).toBeLessThanOrEqual(1);
    expect(levels.slice(-10).every((l) => l >= 3)).toBe(true);

    const { results: rounds } = await db
      .prepare("SELECT seq, opened_at, closed_at FROM rounds WHERE status = 'closed' ORDER BY seq")
      .all<{ seq: number; opened_at: number; closed_at: number }>();
    expect(rounds.length).toBeGreaterThan(10);
    for (const round of rounds) expect(round.closed_at - round.opened_at).toBeGreaterThanOrEqual(MIN_VOTING_MINUTES * MINUTE);
    const durations = rounds.map((r) => (r.closed_at - r.opened_at) / MINUTE);
    expect(Math.max(...durations)).toBeLessThan(30);

    const firstVotingRound = rounds[0]!;
    expect(firstVotingRound.opened_at).toBe(T0 + 30 * MINUTE);
  });

  it('läuft weiter, wenn nur der Agent alle 20 s tickt', async () => {
    const { spotify } = await runEvening({ hours: 3, tvOffline: true });
    const firstQueued = spotify.log.findIndex((e) => e.source === 'queue');
    expect(firstQueued).toBeGreaterThan(0);
    expect(spotify.log.slice(firstQueued).filter((e) => e.source === 'context')).toEqual([]);
  });

  it('erholt sich nach einem Spotify-Ausfall ohne Doppel-Einreihen', async () => {
    const { spotify, db } = await runEvening({ hours: 4, spotifyOutage: { from: 1.5 * HOUR, to: 1.75 * HOUR } });
    expect(spotify.maxQueueLength).toBeLessThanOrEqual(1);
    const queued = spotify.log.filter((e) => e.source === 'queue');
    expect(new Set(queued.map((e) => e.uri)).size).toBe(queued.length);
    const recovered = spotify.log.filter((e) => e.startedAt > T0 + 1.75 * HOUR + 10 * MINUTE);
    expect(recovered.length).toBeGreaterThan(10);
    expect(recovered.filter((e) => e.source === 'context')).toEqual([]);
    const emergencies = await db.prepare("SELECT COUNT(*) AS n FROM observed_plays WHERE kind = 'emergency'").first<{ n: number }>();
    expect(emergencies?.n ?? 0).toBeGreaterThan(0);
  });

  it('wählt auch ohne Stimmen Gewinner aus den Kandidaten der Runde', async () => {
    const { spotify } = await runEvening({ hours: 2, votesPerRound: 0 });
    expect(spotify.log.some((e) => e.source === 'queue')).toBe(true);
  });
});
