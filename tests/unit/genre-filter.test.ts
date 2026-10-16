import { describe, expect, it } from 'vitest';
import {
  BLOCK_MIN_WEIGHT,
  blockedTermSet,
  classify,
  createLastfm,
  loadArtistTags,
} from '../../src/server/services/genres.ts';
import { saveSet } from '../../src/server/services/library.ts';
import { pickCandidates } from '../../src/server/services/rounds.ts';
import {
  createWish,
  decideWish,
  reclassifyWishSongs,
  searchTracks,
  type WishContext,
} from '../../src/server/services/wishes.ts';
import { DEFAULT_BLOCKED_TAGS, defaultSettings, type Settings } from '../../src/shared/settings.ts';
import { FakeLastfm } from '../helpers/fake-lastfm.ts';
import { FakeSpotify, makeTrack } from '../helpers/fake-spotify.ts';
import { testEnv } from '../helpers/runtime.ts';

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const blocked = blockedTermSet(DEFAULT_BLOCKED_TAGS);
const tags = (...list: Array<[string, number]>) => list.map(([name, weight]) => ({ name, weight }));

describe('Genre-Klassifizierung', () => {
  it('sperrt ganze Wortfolgen, nicht Wortteile', () => {
    expect(classify(tags(['nu metal', 100]), blocked).blockedTag).toBe('nu metal');
    expect(classify(tags(['Industrial-Metal', 100]), blocked).blockedTag).toBe('Industrial-Metal');
    expect(classify(tags(['metallica', 100]), blocked).blockedTag).toBeNull();
    expect(classify(tags(['Volkstümliche Musik', 90]), blocked).blockedTag).toBe('Volkstümliche Musik');
    expect(classify(tags(['disco polo', 100]), blocked).blockedTag).toBe('disco polo');
  });

  it('lässt Nebentags unterhalb der Schwelle durch', () => {
    const acdc = tags(['hard rock', 100], ['classic rock', 80], ['heavy metal', BLOCK_MIN_WEIGHT - 1]);
    expect(classify(acdc, blocked)).toEqual({ blockedTag: null, level: 3 });
    expect(classify(tags(['heavy metal', BLOCK_MIN_WEIGHT]), blocked).blockedTag).toBe('heavy metal');
  });

  it('schätzt die Stufe nach Gewicht und nimmt bei Gleichstand die niedrigere', () => {
    expect(classify(tags(['house', 100], ['pop', 60]), blocked).level).toBe(5);
    expect(classify(tags(['dance', 80], ['pop', 80]), blocked).level).toBe(3);
    expect(classify(tags(['Schlager', 100]), blocked).level).toBe(4);
    expect(classify([], blocked)).toEqual({ blockedTag: null, level: null });
  });
});

describe('Last.fm-Client', () => {
  it('liest Tags, behandelt unbekannte Künstler und Rate-Limits', async () => {
    const responses: unknown[] = [
      {
        toptags: {
          tag: [
            { name: 'pop', count: 100 },
            { name: 'rare', count: 3 },
          ],
        },
      },
      { toptags: { tag: { name: 'polka', count: 100 } } },
      { error: 6, message: 'The artist you supplied could not be found' },
      { error: 29, message: 'Rate Limit Exceeded' },
      { error: 11, message: 'Service Offline' },
    ];
    const urls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return Response.json(responses.shift());
    }) as typeof fetch;
    const env = testEnv({ LASTFM_API_KEY: 'key' });
    const lastfm = createLastfm(env, fetcher)!;
    expect(await lastfm.topTags('Earth, Wind & Fire')).toEqual({ ok: true, tags: [{ name: 'pop', weight: 100 }] });
    expect(urls[0]).toContain('artist=Earth%2C+Wind+%26+Fire');
    expect(await lastfm.topTags('x')).toEqual({ ok: true, tags: [{ name: 'polka', weight: 100 }] });
    expect(await lastfm.topTags('x')).toEqual({ ok: true, tags: [] });
    expect(await lastfm.topTags('x')).toEqual({ ok: false, rateLimited: true });
    expect(await lastfm.topTags('x')).toEqual({ ok: false, rateLimited: false });
    expect(createLastfm(testEnv())).toBeNull();
  });

  it('cacht Tags, wartet nach Fehlern gestaffelt und pausiert bei Rate-Limit global', async () => {
    const { DB: db } = testEnv();
    const lastfm = new FakeLastfm();
    lastfm.tag('Band', ['pop', 100]);
    expect((await loadArtistTags(db, lastfm, ['Band'], NOW, 5)).get('band')).toEqual({
      known: true,
      tags: tags(['pop', 100]),
    });
    await loadArtistTags(db, lastfm, ['Band'], NOW + HOUR, 5);
    expect(lastfm.calls).toEqual(['Band']);

    lastfm.offline = true;
    expect((await loadArtistTags(db, lastfm, ['Neu'], NOW, 5)).get('neu')).toEqual({ known: false });
    await loadArtistTags(db, lastfm, ['Neu'], NOW + 5 * 60_000, 5);
    expect(lastfm.calls.filter((c) => c === 'Neu')).toHaveLength(1);
    await loadArtistTags(db, lastfm, ['Neu'], NOW + 11 * 60_000, 5);
    expect(lastfm.calls.filter((c) => c === 'Neu')).toHaveLength(2);
    const row = await db.prepare("SELECT failures, failed_until FROM artist_tags WHERE artist_key = 'neu'").first();
    expect(row).toEqual({ failures: 2, failed_until: NOW + 11 * 60_000 + 30 * 60_000 });

    lastfm.offline = false;
    lastfm.rateLimited = true;
    await loadArtistTags(db, lastfm, ['A', 'B'], NOW, 5);
    const calls = lastfm.calls.length;
    lastfm.rateLimited = false;
    await loadArtistTags(db, lastfm, ['C'], NOW + 30_000, 5);
    expect(lastfm.calls.length).toBe(calls);
    await loadArtistTags(db, lastfm, ['C'], NOW + 61_000, 5);
    expect(lastfm.calls.length).toBe(calls + 1);
  });
});

function track(index: number, artist: string, extra: Partial<ReturnType<typeof makeTrack>> = {}) {
  return { ...makeTrack(index, 200_000, 'party'), title: `party title ${index}`, artist, artists: [artist], ...extra };
}

async function setup(overrides: Partial<Settings> = {}) {
  const env = testEnv();
  const spotify = new FakeSpotify(() => NOW);
  const lastfm = new FakeLastfm();
  lastfm.tag('Rammstein', ['industrial metal', 100], ['german', 70]);
  lastfm.tag('Dua Lipa', ['pop', 100], ['dance', 70]);
  lastfm.tag('Kastelruther Spatzen', ['volksmusik', 100]);
  spotify.add(track(1, 'Rammstein'));
  spotify.add(track(2, 'Dua Lipa'));
  spotify.add(track(3, 'Kastelruther Spatzen'));
  spotify.add(track(4, 'Unbekannt'));
  const settings = { ...defaultSettings(NOW), ...overrides };
  const ctx: WishContext = { spotify, lastfm, settings };
  const setId = await saveSet(
    env.DB,
    { name: 'Party', starts_at: NOW - HOUR, ends_at: NOW + 3 * HOUR, default_level: 4 },
    NOW,
  );
  return { db: env.DB, spotify, lastfm, ctx, setId, uri: (i: number) => track(i, '').uri };
}

describe('Gäste-Suche mit Partyfilter', () => {
  it('blendet gesperrte Treffer aus und meldet die Anzahl', async () => {
    const { db, ctx } = await setup();
    const result = await searchTracks(db, ctx, 'party title', NOW);
    expect(result.tracks.map((t) => t.artist)).toEqual(['Dua Lipa', 'Unbekannt']);
    expect(result.hidden).toBe(2);
    ctx.settings = { ...ctx.settings, filter: { blockedTags: ['pop'] } };
    const again = await searchTracks(db, ctx, 'party title', NOW + 1_000);
    expect(again.tracks.map((t) => t.artist)).toEqual(['Rammstein', 'Kastelruther Spatzen', 'Unbekannt']);
  });

  it('zeigt alles, wenn kein Last.fm-Key konfiguriert ist', async () => {
    const { db, ctx } = await setup();
    const result = await searchTracks(db, { ...ctx, lastfm: null }, 'party title', NOW);
    expect(result).toMatchObject({ hidden: 0 });
    expect(result.tracks).toHaveLength(4);
  });

  it('fragt pro Suche höchstens fünf neue Künstler ab und liest den Cache gebündelt', async () => {
    const { db, spotify, lastfm, ctx } = await setup();
    for (let i = 10; i < 20; i++) spotify.add(track(i, `Neu ${i}`, { title: `bulk ${i}` }));
    let prepared = 0;
    const counting = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'prepare') {
          return (sql: string) => {
            prepared++;
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const result = await searchTracks(counting, ctx, 'bulk', NOW);
    expect(result.tracks).toHaveLength(10);
    expect(lastfm.calls).toHaveLength(5);
    expect(prepared).toBeLessThanOrEqual(15);
  });

  it('zeigt Admin-Songs trotz Sperre und versteckt Songs mit Veto', async () => {
    const { db, ctx, setId } = await setup();
    await db.batch([
      db
        .prepare(
          `INSERT INTO songs (id, spotify_uri, title, artist, duration_ms, title_norm, artist_norm, created_at, vetoed)
         VALUES (1, ?1, 'r', 'Rammstein', 1, 'r', 'r', 0, 0), (2, ?2, 'd', 'Dua Lipa', 1, 'd', 'd', 0, 1)`,
        )
        .bind(track(1, '').uri, track(2, '').uri),
      db.prepare("INSERT INTO set_songs (set_id, song_id, added_at, source) VALUES (?1, 1, 0, 'admin')").bind(setId),
    ]);
    const result = await searchTracks(db, ctx, 'party title', NOW);
    expect(result.tracks.map((t) => t.artist)).toEqual(['Rammstein', 'Unbekannt']);
  });
});

describe('Automatische Freigabe', () => {
  it('gibt passende Wünsche frei, legt sie ins Set und schätzt die Stufe', async () => {
    const { db, ctx, setId, uri } = await setup();
    const wish = await createWish(db, ctx, 'dev-a', uri(2), NOW);
    expect(wish).toMatchObject({ status: 'approved', merged: false });
    const row = await db
      .prepare(
        `SELECT w.decided_at, w.decided_by, ss.set_id, ss.source, s.auto_level, s.mood_level, s.artist_key
         FROM wishes w JOIN songs s ON s.id = w.song_id JOIN set_songs ss ON ss.song_id = s.id WHERE w.id = ?1`,
      )
      .bind(wish.id)
      .first();
    expect(row).toEqual({
      decided_at: NOW,
      decided_by: null,
      set_id: setId,
      source: 'wish',
      auto_level: 3,
      mood_level: null,
      artist_key: 'dua lipa',
    });
  });

  it('lehnt unpassende, explicit und nicht klassifizierbare Wünsche ab', async () => {
    const { db, ctx, lastfm, spotify, uri } = await setup({
      voting: { ...defaultSettings(NOW).voting, allowExplicit: false },
    });
    await expect(createWish(db, ctx, 'dev-a', uri(1), NOW)).rejects.toThrow('not_party_fit');
    await expect(createWish(db, ctx, 'dev-a', uri(3), NOW)).rejects.toThrow('not_party_fit');
    spotify.add(track(5, 'Dua Lipa', { explicit: true }));
    await expect(createWish(db, ctx, 'dev-a', uri(5), NOW)).rejects.toThrow('explicit_not_allowed');
    lastfm.offline = true;
    spotify.add(track(6, 'Offline Band'));
    await expect(createWish(db, ctx, 'dev-a', uri(6), NOW)).rejects.toThrow('classification_unavailable');
    lastfm.offline = false;
    expect(await createWish(db, ctx, 'dev-a', uri(4), NOW)).toMatchObject({ status: 'approved' });
  });

  it('lässt Wünsche ohne Set offen und gibt sie beim Zusammenführen frei, sobald ein Set existiert', async () => {
    const { db, ctx, uri } = await setup();
    await db.prepare('DELETE FROM sets').run();
    const open = await createWish(db, ctx, 'dev-a', uri(2), NOW);
    expect(open.status).toBe('open');
    await saveSet(db, { name: 'Neu', starts_at: NOW, ends_at: NOW + HOUR, default_level: 3 }, NOW);
    const merged = await createWish(db, ctx, 'dev-b', uri(2), NOW + 1);
    expect(merged).toMatchObject({ id: open.id, merged: true, status: 'approved' });
    const songs = await db.prepare("SELECT COUNT(*) AS n FROM set_songs WHERE source = 'wish'").first();
    expect(songs).toEqual({ n: 1 });
  });

  it('kennt kein festes Limit pro Gerät', async () => {
    const { db, ctx, spotify, uri } = await setup();
    for (let i = 20; i < 26; i++) spotify.add(track(i, 'Dua Lipa'));
    const results = await Promise.allSettled(
      [20, 21, 22, 23, 24, 25].map((i) => createWish(db, ctx, 'dev-a', uri(i), NOW)),
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  });
});

describe('Veto und Neu-Klassifizierung', () => {
  it('nimmt den Song aus dem Set, bricht geplante Wiedergabe ab und sperrt erneute Wünsche', async () => {
    const { db, ctx, uri } = await setup();
    const wish = await createWish(db, ctx, 'dev-a', uri(2), NOW);
    const song = await db
      .prepare('SELECT song_id FROM wishes WHERE id = ?1')
      .bind(wish.id)
      .first<{ song_id: number }>();
    await db
      .prepare(
        "INSERT INTO playback (seq, song_id, source, position, votes, status, created_at) VALUES (10, ?1, 'manual', 1, 0, 'planned', 0)",
      )
      .bind(song!.song_id)
      .run();
    const change = await decideWish(db, wish.id, { approve: false }, 1, NOW + 1);
    expect(change.after).toMatchObject({ vetoed: true, cancelledPlayback: 1 });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM set_songs').first()).toEqual({ n: 0 });
    expect(await db.prepare('SELECT status FROM playback').first()).toEqual({ status: 'cancelled' });
    await expect(createWish(db, ctx, 'dev-b', uri(2), NOW + 2)).rejects.toThrow('vetoed');
  });

  it('sperrt bereits gewünschte Songs nach einer Änderung der Sperrliste und hebt Sperren wieder auf', async () => {
    const { db, ctx, uri } = await setup();
    const wish = await createWish(db, ctx, 'dev-a', uri(2), NOW);
    expect(await reclassifyWishSongs(db, ['pop'], NOW + 1)).toEqual({ blocked: 1, unblocked: 0 });
    expect(await db.prepare('SELECT blocked_tag FROM songs').first()).toEqual({ blocked_tag: 'pop' });
    expect(await db.prepare('SELECT status FROM wishes WHERE id = ?1').bind(wish.id).first()).toEqual({
      status: 'rejected',
    });
    expect(await reclassifyWishSongs(db, [], NOW + 2)).toEqual({ blocked: 0, unblocked: 1 });
    expect(await db.prepare('SELECT blocked_tag FROM songs').first()).toEqual({ blocked_tag: null });
  });
});

describe('Kandidatenauswahl mit Wünschen', () => {
  const settings = { ...defaultSettings(NOW), voting: { ...defaultSettings(NOW).voting, candidatesPerRound: 4 } };
  const song = (id: number, level: number, wish: boolean, minutes = 4) => ({
    id,
    set_id: 1,
    duration_ms: minutes * 60_000,
    level,
    wish_id: wish ? id : null,
    device_id: wish ? `dev-${id}` : null,
    upvotes: id,
  });

  it('lässt Wünsche eine Stufe daneben zu, aber nicht gegen die Richtung', () => {
    const pool = [song(1, 3, false), song(2, 4, true), song(3, 2, true), song(4, 4, false)];
    expect(
      pickCandidates(pool, 3, settings, 3)
        .map((s) => s.id)
        .sort(),
    ).toEqual([1, 2, 3]);
    expect(
      pickCandidates(pool, 3, settings, 5)
        .map((s) => s.id)
        .sort(),
    ).toEqual([1, 2]);
    expect(
      pickCandidates(pool, 3, settings, 1)
        .map((s) => s.id)
        .sort(),
    ).toEqual([1, 3]);
  });

  it('bevorzugt die exakte Stufe, wenn ein Wunsch-Song in zwei Sets liegt', () => {
    const picked = pickCandidates([song(7, 4, true), song(7, 3, true)], 3, settings, 3);
    expect(picked).toEqual([song(7, 3, true)]);
  });

  it('füllt höchstens die Hälfte mit Wünschen, außer es fehlt Spielzeit', () => {
    const wishes = [10, 11, 12, 13].map((id) => song(id, 3, true));
    const plain = [20, 21, 22, 23].map((id) => song(id, 3, false, 8));
    const mixed = pickCandidates([...wishes, ...plain], 3, settings);
    expect(mixed.filter((s) => s.wish_id !== null)).toHaveLength(2);
    const thin = pickCandidates([...wishes, song(30, 3, false, 4)], 3, settings);
    expect(thin.map((s) => s.id)).toEqual([13, 12, 30, 11, 10]);
  });
});
