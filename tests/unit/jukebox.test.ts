import { describe, expect, it } from 'vitest';
import { jukeboxOpen, markPlayedWishes, planJukeboxWish } from '../../src/server/services/jukebox.ts';
import { saveSet } from '../../src/server/services/library.ts';
import type { StoredSnapshot } from '../../src/server/services/playback.ts';
import { draftRound, pickCandidates } from '../../src/server/services/rounds.ts';
import { decideWish, guestWishes } from '../../src/server/services/wishes.ts';
import { defaultSettings, type Settings } from '../../src/shared/settings.ts';
import { makeTrack } from '../helpers/fake-spotify.ts';
import { testEnv } from '../helpers/runtime.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const T0 = Date.UTC(2026, 10, 20, 17, 0, 0);

function settingsAt(overrides: Partial<Settings['voting']> = {}): Settings {
  const base = defaultSettings(T0);
  return {
    ...base,
    event: { ...base.event, startsAt: T0 - HOUR, endsAt: T0 + 6 * HOUR },
    voting: { ...base.voting, startsAt: T0 + HOUR, ...overrides },
  };
}

const playing: StoredSnapshot = {
  fetchedAt: T0,
  error: null,
  snapshot: { isPlaying: true, progressMs: 0, track: makeTrack(999), contextUri: 'spotify:playlist:preshow' },
};

function jukebox() {
  const db = testEnv().DB;
  let songs = 0;
  let clock = T0;
  const wish = async (device: string, extra: { explicit?: number; blocked?: string; vetoed?: number } = {}) => {
    const id = ++songs;
    await db.batch([
      db
        .prepare(
          `INSERT INTO songs (id, spotify_uri, title, artist, duration_ms, explicit, title_norm, artist_norm, created_at, blocked_tag, vetoed)
           VALUES (?1, ?2, ?3, 'X', 200000, ?4, ?3, 'x', 0, ?5, ?6)`,
        )
        .bind(
          id,
          `spotify:track:song${String(id).padStart(8, '0')}`,
          `${device}${id}`,
          extra.explicit ?? 0,
          extra.blocked ?? null,
          extra.vetoed ?? 0,
        ),
      db
        .prepare(
          "INSERT INTO wishes (id, song_id, device_id, status, created_at, decided_at) VALUES (?1, ?1, ?2, 'approved', ?3, ?3)",
        )
        .bind(id, device, clock++),
    ]);
    return id;
  };
  const next = async (settings = settingsAt()) => {
    clock += 1_000;
    if (!(await planJukeboxWish(db, settings, clock))) return null;
    const row = await db
      .prepare("SELECT p.id, s.title FROM playback p JOIN songs s ON s.id = p.song_id WHERE p.status = 'planned'")
      .first<{ id: number; title: string }>();
    return row;
  };
  const play = async () => {
    const row = await next();
    if (!row) return null;
    await db.prepare("UPDATE playback SET status = 'played', started_at = ?2 WHERE id = ?1").bind(row.id, clock).run();
    await markPlayedWishes(db);
    return row.title;
  };
  return { db, wish, next, play };
}

describe('Wunsch-Jukebox vor dem Voting', () => {
  it('spielt reihum, auch für Gäste, die später dazukommen', async () => {
    const box = jukebox();
    for (let i = 0; i < 3; i++) await box.wish('a');
    await box.wish('b');
    expect([await box.play(), await box.play(), await box.play()]).toEqual(['a1', 'b4', 'a2']);
    await box.wish('c');
    expect([await box.play(), await box.play(), await box.play()]).toEqual(['c5', 'a3', null]);
  });

  it('lässt einen neuen Gast nach einem Viel-Wünscher abwechselnd dran', async () => {
    const box = jukebox();
    for (let i = 0; i < 7; i++) await box.wish('a');
    for (let i = 0; i < 5; i++) await box.play();
    await box.wish('b');
    await box.wish('b');
    expect([await box.play(), await box.play(), await box.play(), await box.play()]).toEqual(['b8', 'a6', 'b9', 'a7']);
  });

  it('plant nur einen Song voraus und keinen zweiten bei doppeltem Aufruf', async () => {
    const box = jukebox();
    await box.wish('a');
    await box.wish('b');
    expect(await box.next()).toMatchObject({ title: 'a1' });
    expect(await box.next()).toBeNull();
    expect(await box.db.prepare('SELECT COUNT(*) AS n FROM playback').first()).toEqual({ n: 1 });
  });

  it('lässt anonyme, gesperrte, per Veto entfernte und unerlaubte explizite Songs aus', async () => {
    const box = jukebox();
    await box.wish('anon');
    await box.wish('a', { blocked: 'metal' });
    await box.wish('b', { vetoed: 1 });
    await box.wish('c', { explicit: 1 });
    expect(await box.next(settingsAt({ allowExplicit: false }))).toBeNull();
    expect(await box.next(settingsAt({ allowExplicit: true }))).toMatchObject({ title: 'c4' });
  });

  it('plant abgebrochene Wünsche neu und überspringt sie nach zwei Fehlschlägen', async () => {
    const box = jukebox();
    await box.wish('a');
    await box.wish('b');
    for (let attempt = 0; attempt < 2; attempt++) {
      const planned = await box.next();
      expect(planned?.title).toBe('a1');
      await box.db.prepare("UPDATE playback SET status = 'missed' WHERE id = ?1").bind(planned!.id).run();
    }
    expect(await box.play()).toBe('b2');
  });

  it('zeigt geplante Wünsche als „läuft gleich“ und markiert sie erst nach dem Abspielen als gespielt', async () => {
    const box = jukebox();
    await box.wish('a');
    await box.next();
    expect((await guestWishes(box.db, 'a'))[0]?.status).toBe('queued');
    await box.db.prepare("UPDATE playback SET status = 'playing', started_at = 1").run();
    await markPlayedWishes(box.db);
    expect((await guestWishes(box.db, 'a'))[0]?.status).toBe('played');
  });

  it('erlaubt ein Veto auf geplante Wünsche und bricht den Eintrag ab', async () => {
    const box = jukebox();
    const id = await box.wish('a');
    await box.next();
    await decideWish(box.db, id, { approve: false }, 1, T0 + HOUR);
    expect(await box.db.prepare('SELECT status FROM playback').first()).toEqual({ status: 'cancelled' });
    expect(await box.next()).toBeNull();
  });

  it('öffnet nur vor dem Voting, mit Genre-Filter, Freigabe und laufender Wiedergabe', () => {
    const settings = settingsAt();
    expect(jukeboxOpen(settings, playing, T0, true)).toBe(true);
    expect(jukeboxOpen(settings, playing, T0, false)).toBe(false);
    expect(jukeboxOpen(settings, playing, T0 + HOUR, true)).toBe(false);
    expect(jukeboxOpen(settings, playing, T0 - 2 * HOUR, true)).toBe(false);
    expect(jukeboxOpen(settingsAt({ enabled: false }), playing, T0, true)).toBe(false);
    expect(jukeboxOpen({ ...settings, wishes: { autoApprove: false } }, playing, T0, true)).toBe(false);
    const paused = { ...playing, snapshot: { ...playing.snapshot!, isPlaying: false } };
    expect(jukeboxOpen(settings, paused, T0, true)).toBe(false);
    expect(jukeboxOpen(settings, playing, T0 + 2 * MINUTE, true)).toBe(false);
  });
});

describe('Wünsche im Voting', () => {
  it('verteilt die Wunsch-Hälfte zuerst auf verschiedene Geräte', () => {
    const settings = { ...settingsAt(), voting: { ...settingsAt().voting, candidatesPerRound: 4 } };
    const song = (id: number, device: string, upvotes: number, wish = true) => ({
      id,
      set_id: 1,
      duration_ms: 20 * MINUTE,
      level: 3,
      wish_id: wish ? id : null,
      device_id: wish ? device : null,
      upvotes,
    });
    const picked = pickCandidates(
      [
        song(1, 'x', 9),
        song(2, 'x', 8),
        song(3, 'x', 7),
        song(4, 'y', 0),
        song(5, '', 0, false),
        song(6, '', 0, false),
      ],
      3,
      settings,
    );
    expect(picked.slice(0, 2).map((s) => s.id)).toEqual([1, 4]);
  });

  it('nimmt Wünsche aus nicht benachbarten Sets in die Runde', async () => {
    const db = testEnv().DB;
    const setIds: number[] = [];
    for (let i = 0; i < 4; i++) {
      setIds.push(
        await saveSet(
          db,
          { name: `S${i}`, starts_at: T0 + i * HOUR, ends_at: T0 + (i + 1) * HOUR, default_level: 3 },
          T0,
        ),
      );
    }
    await db.batch([
      db.prepare(
        `INSERT INTO songs (id, spotify_uri, title, artist, duration_ms, title_norm, artist_norm, created_at)
         VALUES (1, 'spotify:track:early0000001', 'Früh', 'X', 200000, 'f', 'x', 0)`,
      ),
      db.prepare("INSERT INTO set_songs (set_id, song_id, added_at, source) VALUES (?1, 1, 0, 'wish')").bind(setIds[0]),
      db.prepare("INSERT INTO wishes (id, song_id, device_id, status, created_at) VALUES (1, 1, 'a', 'approved', 0)"),
    ]);
    const draft = await draftRound(db, settingsAt(), 3, T0 + 3.5 * HOUR, null);
    expect(draft.set?.id).toBe(setIds[3]);
    expect(draft.candidates.map((c) => c.id)).toContain(1);
  });
});
