import { describe, expect, it } from 'vitest';
import { MIN_VOTING_MINUTES } from '../../src/shared/settings.ts';
import { importTracks, saveSet } from '../../src/server/services/library.ts';
import { openRound } from '../../src/server/services/rounds.ts';
import { loadSettings, saveSettings } from '../../src/server/services/settings.ts';
import { tick } from '../../src/server/services/tick.ts';
import { castVote } from '../../src/server/services/votes.ts';
import type { SpotifyTrack } from '../../src/server/services/spotify-api.ts';
import { createWish } from '../../src/server/services/wishes.ts';
import { FakeLastfm } from '../helpers/fake-lastfm.ts';
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
  spotifyPause?: { from: number; to: number };
  votesPerRound?: number;
  tvOffline?: boolean;
  guestWishEveryMinutes?: number;
  preVotingWishes?: Record<string, number>;
}

async function runEvening(scenario: Scenario) {
  const clock = new Clock(T0);
  const env = testEnv();
  const db = env.DB;
  const spotify = new FakeSpotify(clock.now);
  const lastfm = new FakeLastfm();
  lastfm.tag('Pop Star', ['pop', 100]);
  lastfm.tag('Metal Band', ['thrash metal', 100]);
  const rt = testRuntime(env, clock, spotify, lastfm);
  const random = seededRandom(42);
  const blockedUris = new Set<string>();
  const wishUris = new Set<string>();
  let nextWishAt = T0 + 30 * MINUTE;

  await saveSettings(db, 'event', { startsAt: T0, endsAt: T0 + scenario.hours * HOUR }, T0, null);
  await saveSettings(db, 'voting', { startsAt: T0 + 30 * MINUTE }, T0, null);
  await saveSettings(db, 'preshow', { playlistUri: 'spotify:playlist:preshow123', level: 2 }, T0, null);

  const warmup = await saveSet(db, { name: 'Warm-up', starts_at: T0, ends_at: T0 + 2.5 * HOUR, default_level: 2 }, T0);
  const party = await saveSet(
    db,
    { name: 'Party', starts_at: T0 + 2.5 * HOUR, ends_at: T0 + 8 * HOUR, default_level: 4 },
    T0,
  );

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

  const jukeboxUris = new Map<string, string>();
  for (const [device, count] of Object.entries(scenario.preVotingWishes ?? {})) {
    for (let i = 0; i < count; i++) {
      const track = { ...makeTrack(i, 200_000, `jb${device}`), artist: 'Pop Star', artists: ['Pop Star'] };
      spotify.add(track);
      levelByUri.set(track.uri, 3);
      jukeboxUris.set(track.uri, `${device}${i + 1}`);
      clock.advance(4_000);
      const settings = await loadSettings(db, clock.time);
      await createWish(db, { spotify, lastfm, settings }, device, track.uri, clock.time);
    }
  }

  const end = T0 + scenario.hours * HOUR;
  let lastVoteRound = 0;
  while (clock.time < end) {
    const outage = scenario.spotifyOutage;
    spotify.offline = Boolean(outage && clock.time >= T0 + outage.from && clock.time < T0 + outage.to);
    const pause = scenario.spotifyPause;
    if (pause && clock.time >= T0 + pause.from && clock.time < T0 + pause.to) spotify.pause();
    else spotify.resume();
    if (scenario.guestWishEveryMinutes && clock.time >= nextWishAt) {
      nextWishAt += scenario.guestWishEveryMinutes * MINUTE;
      const index = wishUris.size + blockedUris.size;
      const metal = index % 2 === 1;
      const track = { ...makeTrack(index, 200_000, 'wish'), artist: metal ? 'Metal Band' : 'Pop Star' };
      track.artists = [track.artist];
      spotify.add(track);
      levelByUri.set(track.uri, 3);
      (metal ? blockedUris : wishUris).add(track.uri);
      const settings = await loadSettings(db, clock.time);
      await createWish(db, { spotify, lastfm, settings }, `guest-${index}`, track.uri, clock.time).catch(
        (error: Error) => expect(error.message).toBe('not_party_fit'),
      );
    }
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
          now: clock.time,
        });
      }
    }
    clock.advance(scenario.tvOffline ? 20_000 : 5_000);
  }
  return { db, spotify, levelByUri, blockedUris, wishUris, jukeboxUris };
}

describe('Abendsimulation', { timeout: 30_000 }, () => {
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
    for (const round of rounds)
      expect(round.closed_at - round.opened_at).toBeGreaterThanOrEqual(MIN_VOTING_MINUTES * MINUTE);
    const durations = rounds.map((r) => (r.closed_at - r.opened_at) / MINUTE);
    expect(Math.max(...durations)).toBeLessThan(30);

    const firstVotingRound = rounds[0]!;
    expect(firstVotingRound.opened_at).toBe(T0 + 30 * MINUTE);
  });

  it('spielt freie Gästewünsche ohne Lücken und nie gesperrte Titel', async () => {
    const { db, spotify, blockedUris, wishUris, levelByUri } = await runEvening({
      hours: 6,
      guestWishEveryMinutes: 10,
    });
    const queued = spotify.log.filter((e) => e.source === 'queue');
    const firstQueued = spotify.log.findIndex((e) => e.source === 'queue');
    expect(spotify.log.slice(firstQueued).filter((e) => e.source === 'context')).toEqual([]);
    expect(queued.some((e) => blockedUris.has(e.uri))).toBe(false);
    const { results } = await db
      .prepare('SELECT DISTINCT s.spotify_uri FROM round_candidates c JOIN songs s ON s.id = c.song_id')
      .all<{ spotify_uri: string }>();
    expect(results.some((r) => blockedUris.has(r.spotify_uri))).toBe(false);
    expect(results.filter((r) => wishUris.has(r.spotify_uri)).length).toBeGreaterThan(wishUris.size / 2);
    const levels = queued.map((e) => levelByUri.get(e.uri)!);
    for (let i = 1; i < levels.length; i++) expect(Math.abs(levels[i]! - levels[i - 1]!)).toBeLessThanOrEqual(2);
  });

  it('spielt Vorab-Wünsche reihum bis zum Voting und nimmt den Rest ins Voting', async () => {
    const { db, spotify, jukeboxUris } = await runEvening({ hours: 3, preVotingWishes: { a: 10, b: 1, c: 2 } });
    const votingStart = T0 + 30 * MINUTE;
    const played = spotify.log.filter((e) => jukeboxUris.has(e.uri));
    expect(played.map((e) => jukeboxUris.get(e.uri)).slice(0, 6)).toEqual(['a1', 'b1', 'c1', 'a2', 'c2', 'a3']);
    expect(spotify.maxQueueLength).toBeLessThanOrEqual(1);
    const late = await db
      .prepare('SELECT COUNT(*) AS n FROM playback WHERE wish_id IS NOT NULL AND created_at >= ?1')
      .bind(votingStart)
      .first<{ n: number }>();
    expect(late?.n).toBe(0);
    const leftover = [...jukeboxUris.keys()].filter((uri) => !played.some((e) => e.uri === uri));
    expect(leftover.length).toBeGreaterThan(0);
    const { results } = await db
      .prepare('SELECT DISTINCT s.spotify_uri FROM round_candidates c JOIN songs s ON s.id = c.song_id')
      .all<{ spotify_uri: string }>();
    expect(leftover.some((uri) => results.some((r) => r.spotify_uri === uri))).toBe(true);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM observed_plays WHERE kind = 'emergency'").first()).toEqual({
      n: 0,
    });
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
    const emergencies = await db
      .prepare("SELECT COUNT(*) AS n FROM observed_plays WHERE kind = 'emergency'")
      .first<{ n: number }>();
    expect(emergencies?.n ?? 0).toBeGreaterThan(0);
  });

  it('spielt nach einer langen Pause jeden Song genau einmal und hält die Mindest-Abstimmzeit', async () => {
    const { spotify, db } = await runEvening({
      hours: 4,
      spotifyPause: { from: 1.5 * HOUR, to: 1.5 * HOUR + 8 * MINUTE },
    });
    expect(spotify.maxQueueLength).toBeLessThanOrEqual(1);
    const queued = spotify.log.filter((e) => e.source === 'queue');
    expect(queued.length).toBeGreaterThan(30);
    expect(new Set(queued.map((e) => e.uri)).size).toBe(queued.length);
    const firstQueued = spotify.log.findIndex((e) => e.source === 'queue');
    expect(spotify.log.slice(firstQueued).filter((e) => e.source === 'context')).toEqual([]);
    const { results: rounds } = await db
      .prepare("SELECT opened_at, closed_at FROM rounds WHERE status = 'closed'")
      .all<{ opened_at: number; closed_at: number }>();
    for (const round of rounds)
      expect(round.closed_at - round.opened_at).toBeGreaterThanOrEqual(MIN_VOTING_MINUTES * MINUTE);
    const missed = await db
      .prepare("SELECT COUNT(*) AS n FROM playback WHERE status = 'missed'")
      .first<{ n: number }>();
    expect(missed?.n).toBe(0);
  });

  it('wählt auch ohne Stimmen Gewinner aus den Kandidaten der Runde', async () => {
    const { spotify } = await runEvening({ hours: 2, votesPerRound: 0 });
    expect(spotify.log.some((e) => e.source === 'queue')).toBe(true);
  });
});
