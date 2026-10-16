import { describe, expect, it, vi } from 'vitest';
import { guestCoversAllowed, readBudget, refreshBudget, throttleFactor } from '../../src/server/services/budget.ts';
import { importTracks, saveSet, setCoverage } from '../../src/server/services/library.ts';
import { consumptionStats } from '../../src/server/services/ledger.ts';
import { loadSettings, saveSettings } from '../../src/server/services/settings.ts';
import {
  authStatus,
  exchangeCode,
  loadTokens,
  storeTokens,
  validAccessToken,
} from '../../src/server/services/spotify-auth.ts';
import {
  parseSpotifyReference,
  spotifyFailureKind,
  unsupportedSpotifyReference,
} from '../../src/server/services/spotify-api.ts';
import { createHttpSpotify, pathTemplate } from '../../src/server/services/spotify-http.ts';
import { createWish, decideWish, guestWishes, searchTracks, upvoteWish } from '../../src/server/services/wishes.ts';
import { claimPairing, pollPairing, startPairing, authenticateDisplay } from '../../src/server/services/displays.ts';
import { FakeSpotify, makeTrack } from '../helpers/fake-spotify.ts';
import { Clock, testEnv } from '../helpers/runtime.ts';

const NOW = 1_800_000_000_000;

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function fakeFetch(handler: Handler) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fetcher, calls };
}

const rawTrack = {
  uri: 'spotify:track:abcdefghij',
  name: 'Song',
  duration_ms: 200_000,
  explicit: false,
  artists: [{ name: 'Band' }, { name: 'Gast' }],
  album: {
    name: 'Album',
    images: [
      { url: 'https://i.scdn.co/big', width: 640 },
      { url: 'https://i.scdn.co/mid', width: 300 },
    ],
  },
  external_ids: { isrc: 'deabc1234567' },
};

describe('Spotify-Anbindung', () => {
  it('tauscht den OAuth-Code und erneuert abgelaufene Tokens genau einmal', async () => {
    const env = testEnv({ SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' });
    const { fetcher, calls } = fakeFetch((url, init) => {
      if (url.endsWith('/api/token')) {
        const body = String(init.body);
        if (body.includes('authorization_code'))
          return Response.json({ access_token: 'a1', refresh_token: 'r1', expires_in: 3600 });
        return Response.json({ access_token: 'a2', expires_in: 3600 });
      }
      return Response.json({ display_name: 'Party-Account' });
    });
    const exchange = await exchangeCode(env, 'code', 'https://x/cb', NOW, fetcher);
    expect(exchange.ok && exchange.tokens.accountName).toBe('Party-Account');
    expect((await authStatus(env)).connected).toBe(true);
    expect(await validAccessToken(env, NOW + 1000, fetcher)).toBe('a1');
    expect(await validAccessToken(env, NOW + 3_590_000, fetcher)).toBe('a2');
    expect((await loadTokens(env))?.refreshToken).toBe('r1');
    expect(calls.filter((c) => c.url.endsWith('/api/token'))).toHaveLength(2);
  });

  it('mappt Player-Antworten, erkennt fehlendes Gerät und hält Rate-Limits ein', async () => {
    const env = testEnv();
    await storeTokens(
      env,
      { accessToken: 'tok', refreshToken: 'r', expiresAt: NOW + 3_600_000, authorizedAt: NOW, accountName: null },
      NOW,
    );
    const clock = new Clock(NOW);
    let mode: 'ok' | 'nodevice' | 'limited' = 'ok';
    const { fetcher, calls } = fakeFetch((url) => {
      if (mode === 'limited') return new Response('', { status: 429, headers: { 'Retry-After': '30' } });
      if (url.includes('/me/player/queue') && mode === 'nodevice')
        return new Response('{"error":{"reason":"NO_ACTIVE_DEVICE"}}', { status: 404 });
      if (url.includes('/me/player/queue')) return new Response(null, { status: 204 });
      if (url.includes('currently-playing'))
        return Response.json({
          is_playing: true,
          progress_ms: 1000,
          item: rawTrack,
          context: { uri: 'spotify:playlist:x' },
        });
      if (url.includes('/search')) return Response.json({ tracks: { items: [rawTrack, { uri: 'spotify:local:x' }] } });
      if (url.includes('/playlists/'))
        return Response.json({ items: [{ item: rawTrack }, { track: rawTrack }], total: 120, next: 'n' });
      return Response.json({});
    });
    const spotify = createHttpSpotify(env, clock.now, fetcher);
    const playing = await spotify.currentlyPlaying();
    expect(playing.ok && playing.value.track).toMatchObject({
      artist: 'Band, Gast',
      isrc: 'DEABC1234567',
      imageUrl: 'https://i.scdn.co/mid',
    });
    expect((await spotify.addToQueue('spotify:track:abcdefghij')).ok).toBe(true);
    expect(calls.at(-1)?.init.headers).toMatchObject({ Authorization: 'Bearer tok' });
    const search = await spotify.search('song');
    expect(search.ok && search.value).toHaveLength(1);
    const page = await spotify.playlistPage('pl', 0);
    expect(page.ok && page.value).toMatchObject({ next: 2, total: 120 });
    mode = 'nodevice';
    expect(await spotify.addToQueue('spotify:track:abcdefghij')).toMatchObject({ ok: false, kind: 'no_device' });
    mode = 'limited';
    expect(await spotify.currentlyPlaying()).toMatchObject({ ok: false, kind: 'rate_limited' });
    mode = 'ok';
    const before = calls.length;
    clock.advance(10_000);
    expect(await spotify.currentlyPlaying()).toMatchObject({ ok: false, kind: 'rate_limited' });
    expect(calls.length).toBe(before);
    clock.advance(25_000);
    expect((await spotify.currentlyPlaying()).ok).toBe(true);
  });

  it('erkennt die Spotify-Sperren seit 2026 an Reason und Meldung', () => {
    const body = (message: string, reason?: string) => JSON.stringify({ error: { status: 403, message, reason } });
    expect(spotifyFailureKind(403, body('Active premium subscription required for the owner of the app.'))).toBe(
      'owner_premium_required',
    );
    expect(spotifyFailureKind(403, body('Player command failed: Premium required', 'PREMIUM_REQUIRED'))).toBe(
      'premium_required',
    );
    expect(
      spotifyFailureKind(403, body('Check settings on developer dashboard, the user may not be registered.')),
    ).toBe('user_not_registered');
    expect(spotifyFailureKind(403, '')).toBe('forbidden');
    expect(spotifyFailureKind(403, 'Forbidden')).toBe('forbidden');
    expect(spotifyFailureKind(400, body('Invalid limit'))).toBe('client_error');
    expect(spotifyFailureKind(401, '')).toBe('unauthorized');
    expect(spotifyFailureKind(404, '{"error":{"reason":"NO_ACTIVE_DEVICE"}}')).toBe('no_device');
    expect(spotifyFailureKind(503, '')).toBe('unknown');
  });

  it('loggt Spotify-Fehler ohne IDs, Query und Meldungstext, höchstens einmal pro Minute', async () => {
    const env = testEnv();
    const later = NOW + 1_000_000;
    await storeTokens(
      env,
      { accessToken: 'tok', refreshToken: 'r', expiresAt: later + 3_600_000, authorizedAt: later, accountName: null },
      later,
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fetcher } = fakeFetch(
      () =>
        new Response(
          JSON.stringify({ error: { message: 'Active premium subscription required for the owner of the app.' } }),
          {
            status: 403,
          },
        ),
    );
    const clock = new Clock(later);
    const spotify = createHttpSpotify(env, clock.now, fetcher);
    expect(await spotify.search('geheimer suchbegriff')).toMatchObject({ ok: false, kind: 'owner_premium_required' });
    await spotify.search('noch einer');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toBe('spotify GET /search 403 owner_premium_required reason=-');
    clock.advance(61_000);
    await spotify.track('4uLU6hMCjMI75M1A2tKUQC');
    expect(String(warn.mock.calls.at(-1)![0])).toContain('GET /tracks/:id 403');
    warn.mockRestore();
    expect(pathTemplate('/playlists/37i9dQZF1DXcBWIGoYBM5M/items?limit=50')).toBe('/playlists/:id/items');
  });

  it('meldet fremde Playlists als gesperrt und beendet leere Seiten', async () => {
    const env = testEnv();
    const later = NOW + 2_000_000;
    await storeTokens(
      env,
      { accessToken: 'tok', refreshToken: 'r', expiresAt: later + 3_600_000, authorizedAt: later, accountName: null },
      later,
    );
    let response: unknown = { name: 'Fremd', total: 30 };
    const { fetcher } = fakeFetch(() => Response.json(response));
    const spotify = createHttpSpotify(env, () => later, fetcher);
    expect(await spotify.playlistPage('pl', 0)).toMatchObject({ ok: false, kind: 'forbidden' });
    response = { items: [], total: 30, next: 'https://api.spotify.com/v1/playlists/pl/items?offset=50' };
    expect(await spotify.playlistPage('pl', 50)).toMatchObject({ ok: true, value: { tracks: [], next: null } });
  });

  it('übersteht Netzfehler beim Token-Refresh ohne Ausnahme', async () => {
    const env = testEnv({ SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' });
    const later = NOW + 3_000_000;
    await storeTokens(
      env,
      { accessToken: 'old', refreshToken: 'r', expiresAt: later - 1, authorizedAt: later, accountName: null },
      later,
    );
    const failing = (async () => {
      throw new TypeError('network');
    }) as typeof fetch;
    expect(await validAccessToken(env, later, failing)).toBeNull();
    expect(await createHttpSpotify(env, () => later, failing).search('song')).toMatchObject({
      ok: false,
      kind: 'not_connected',
    });
  });

  it('speichert keine Verbindung, wenn Spotify das Konto sperrt', async () => {
    const env = testEnv({ SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' });
    const { fetcher } = fakeFetch((url) => {
      if (url.endsWith('/api/token'))
        return Response.json({ access_token: 'a1', refresh_token: 'r1', expires_in: 3600 });
      return new Response(
        JSON.stringify({
          error: { message: 'Check settings on developer dashboard, the user may not be registered.' },
        }),
        { status: 403 },
      );
    });
    expect(await exchangeCode(env, 'code', 'https://x/cb', NOW, fetcher)).toEqual({
      ok: false,
      kind: 'user_not_registered',
    });
    expect(await loadTokens(env)).toBeNull();
  });

  it('erkennt Alt-URIs und erklärt nicht unterstützte Links', () => {
    expect(parseSpotifyReference('spotify:user:party:playlist:37i9dQZF1DXcBWIGoYBM5M')).toEqual({
      kind: 'playlist',
      id: '37i9dQZF1DXcBWIGoYBM5M',
    });
    expect(unsupportedSpotifyReference('https://spotify.link/abcDEF')).toBe('short_link_unsupported');
    expect(unsupportedSpotifyReference('https://open.spotify.com/intl-de/album/1A2GTWGtFfWp7KSQTwWOyo')).toBe(
      'album_link_unsupported',
    );
    expect(unsupportedSpotifyReference('spotify:album:1A2GTWGtFfWp7KSQTwWOyo')).toBe('album_link_unsupported');
    expect(unsupportedSpotifyReference('irgendwas')).toBeNull();
  });

  it('meldet fehlende Verbindung ohne Netzwerkzugriff', async () => {
    const env = testEnv();
    const { fetcher, calls } = fakeFetch(() => Response.json({}));
    expect(await createHttpSpotify(env, () => NOW + 3_600_000, fetcher).player()).toMatchObject({
      ok: false,
      kind: 'not_connected',
    });
    expect(calls).toHaveLength(0);
  });
});

describe('Budget-Wächter', () => {
  it('liest die Tagesnutzung, drosselt ab 60 % und blendet Gast-Cover ab 80 % aus', async () => {
    const env = testEnv({ CF_ANALYTICS_TOKEN: 't', CF_ACCOUNT_ID: 'acc' });
    const { fetcher } = fakeFetch(() =>
      Response.json({ data: { viewer: { accounts: [{ data: [{ sum: { requests: 61_000 } }] }] } } }),
    );
    await refreshBudget(env, NOW, fetcher);
    const budget = await readBudget(env.DB);
    expect(budget).toMatchObject({ requestsToday: 61_000, error: null });
    expect(throttleFactor(budget, NOW)).toBe(2);
    expect(throttleFactor({ ...budget!, fraction: 0.85 }, NOW)).toBe(4);
    expect(throttleFactor(budget, NOW + 3_600_000)).toBe(1);
    expect(throttleFactor(null, NOW)).toBe(1);
    expect(guestCoversAllowed(budget, NOW)).toBe(true);
    expect(guestCoversAllowed({ ...budget!, fraction: 0.79 }, NOW)).toBe(true);
    expect(guestCoversAllowed({ ...budget!, fraction: 0.8 }, NOW)).toBe(false);
    expect(guestCoversAllowed({ ...budget!, fraction: 0.85 }, NOW + 3_600_000)).toBe(true);
    expect(guestCoversAllowed(null, NOW)).toBe(true);
  });
});

describe('Songwünsche', () => {
  async function setup() {
    const env = testEnv();
    const spotify = new FakeSpotify(() => NOW);
    for (let i = 0; i < 5; i++) spotify.add(makeTrack(i, 200_000, 'wish'));
    return { db: env.DB, spotify };
  }

  it('cacht Suchen und deckelt Spotify-Aufrufe global', async () => {
    const { db, spotify } = await setup();
    expect((await searchTracks(db, spotify, 'wi', NOW)).tracks).toEqual([]);
    const first = await searchTracks(db, spotify, 'wish title 1', NOW);
    expect(first.tracks[0]?.title).toBe('wish title 1');
    for (let i = 0; i < 12; i++) await searchTracks(db, spotify, `wish title ${i}x`, NOW);
    const limited = await searchTracks(db, spotify, 'ganz neu', NOW);
    expect(limited.limited).toBe(true);
    expect((await searchTracks(db, spotify, 'Wish  Title 1', NOW)).tracks[0]?.title).toBe('wish title 1');
  });

  it('legt Tickets an, führt Duplikate zusammen, begrenzt offene Wünsche und erlaubt +1 nur nach Freigabe', async () => {
    const { db, spotify } = await setup();
    const uri = (i: number) => makeTrack(i, 200_000, 'wish').uri;
    const created = await createWish(db, spotify, 'dev-a', uri(0), NOW);
    expect(created).toMatchObject({ key: 'FETE-1', merged: false });
    expect(await createWish(db, spotify, 'dev-b', uri(0), NOW)).toMatchObject({ key: 'FETE-1', merged: true });
    await createWish(db, spotify, 'dev-a', uri(1), NOW);
    await createWish(db, spotify, 'dev-a', uri(2), NOW);
    await expect(createWish(db, spotify, 'dev-a', uri(3), NOW)).rejects.toThrow('too_many_open_wishes');
    await expect(createWish(db, spotify, 'dev-a', 'spotify:track:../../x', NOW)).rejects.toThrow('invalid_track');

    expect(await upvoteWish(db, created.id, 'dev-c', NOW)).toBe(false);
    const setId = await saveSet(db, { name: 'S', starts_at: NOW, ends_at: NOW + 3_600_000, default_level: 3 }, NOW);
    await decideWish(db, created.id, { approve: true, setId, level: 4 }, 1, NOW);
    expect(await upvoteWish(db, created.id, 'dev-c', NOW)).toBe(true);
    expect(await upvoteWish(db, created.id, 'dev-c', NOW)).toBe(false);
    await decideWish(db, 2, { approve: false }, 1, NOW);

    const forOther = await guestWishes(db, 'dev-z');
    expect(forOther.map((w) => w.key)).toEqual(['FETE-1']);
    const mine = await guestWishes(db, 'dev-a');
    expect(mine.filter((w) => w.mine)).toHaveLength(3);
    const level = await db
      .prepare('SELECT mood_level FROM songs WHERE spotify_uri = ?1')
      .bind(uri(0))
      .first<{ mood_level: number }>();
    expect(level?.mood_level).toBe(4);
  });

  it('entscheidet nur offene Wünsche und schreibt bei Fehlern nichts nebenbei', async () => {
    const { db, spotify } = await setup();
    const uri = (i: number) => makeTrack(i, 200_000, 'wish').uri;
    const setId = await saveSet(db, { name: 'S', starts_at: NOW, ends_at: NOW + 3_600_000, default_level: 3 }, NOW);
    const first = await createWish(db, spotify, 'dev-a', uri(0), NOW);
    await decideWish(db, first.id, { approve: false }, 1, NOW);
    const second = await createWish(db, spotify, 'dev-b', uri(0), NOW + 1);
    expect(second.merged).toBe(false);

    await expect(decideWish(db, first.id, { approve: true, setId, level: 5 }, 1, NOW + 2)).rejects.toThrow(
      'wish_not_open',
    );
    await decideWish(db, second.id, { approve: true, setId, level: null }, 1, NOW + 3);
    await expect(decideWish(db, second.id, { approve: false }, 1, NOW + 4)).rejects.toThrow('wish_not_open');
    await expect(decideWish(db, second.id, { approve: true, setId, level: 1 }, 1, NOW + 5)).rejects.toThrow(
      'wish_not_open',
    );
    const song = await db
      .prepare('SELECT mood_level FROM songs WHERE spotify_uri = ?1')
      .bind(uri(0))
      .first<{ mood_level: number | null }>();
    expect(song?.mood_level).toBeNull();

    const third = await createWish(db, spotify, 'dev-c', uri(1), NOW);
    await expect(decideWish(db, third.id, { approve: true, setId: 999, level: 4 }, 1, NOW)).rejects.toThrow(
      'set_not_found',
    );
    const status = await db
      .prepare('SELECT status FROM wishes WHERE id = ?1')
      .bind(third.id)
      .first<{ status: string }>();
    expect(status?.status).toBe('open');
  });
});

describe('Event-Dauer', () => {
  it('lehnt Events über 48 h ab und begrenzt die Verbrauchskurve auch für Altwerte', async () => {
    const { DB: db } = testEnv();
    await expect(saveSettings(db, 'event', { startsAt: NOW, endsAt: NOW + 49 * 3_600_000 }, NOW, null)).rejects.toThrow(
      'event_too_long',
    );
    const settings = await loadSettings(db, NOW);
    const stats = consumptionStats([], { ...settings, event: { ...settings.event, startsAt: 0, endsAt: NOW } }, NOW);
    expect(stats.series.length).toBeLessThanOrEqual(48 * 4 + 1);
  });
});

describe('Bibliothek-Import und Abdeckung', () => {
  it('bricht den Import mit gelöschtem Set ab, ohne Songs halb anzulegen', async () => {
    const { DB: db } = testEnv();
    await expect(importTracks(db, [makeTrack(1)], 999, NOW)).rejects.toThrow('set_not_found');
    expect((await db.prepare('SELECT COUNT(*) AS n FROM songs').first<{ n: number }>())?.n).toBe(0);
  });

  it('importiert seitenweise, erkennt Duplikate per ISRC und berechnet die Abdeckung', async () => {
    const { DB: db } = testEnv();
    const setId = await saveSet(db, { name: 'Party', starts_at: NOW, ends_at: NOW + 3_600_000, default_level: 4 }, NOW);
    const tracks = Array.from({ length: 30 }, (_, i) => makeTrack(i, 240_000, 'imp'));
    const duplicate = { ...tracks[0]!, uri: 'spotify:track:otheruri00000' };
    expect((await importTracks(db, [...tracks, duplicate], setId, NOW)).imported).toBe(30);
    const count = await db.prepare('SELECT COUNT(*) AS n FROM songs').first<{ n: number }>();
    expect(count?.n).toBe(30);
    await expect(
      importTracks(
        db,
        Array.from({ length: 61 }, (_, i) => makeTrack(i)),
        null,
        NOW,
      ),
    ).rejects.toThrow('too_many_tracks');
    const [coverage] = await setCoverage(db);
    expect(coverage).toMatchObject({ durationMinutes: 60, nearbyMinutes: 120, ok: true });
    expect(coverage?.byLevel[4]).toEqual({ songs: 30, minutes: 120 });
  });
});

describe('Display-Kopplung', () => {
  it('gibt das Token nur mit passendem Geheimnis und nur innerhalb der Zustellfrist heraus', async () => {
    const env = testEnv();
    const pairing = await startPairing(env.DB, NOW);
    expect(await pollPairing(env.DB, env.ENC_KEY, pairing.code, pairing.secret, NOW)).toEqual({ status: 'pending' });
    await expect(claimPairing(env.DB, env.ENC_KEY, { code: '000000', name: 'x', kind: 'tv' }, 1, NOW)).rejects.toThrow(
      'pairing_not_found',
    );
    await claimPairing(env.DB, env.ENC_KEY, { code: pairing.code, name: 'TV', kind: 'tv' }, 1, NOW);
    expect(await pollPairing(env.DB, env.ENC_KEY, pairing.code, 'falsch'.repeat(5), NOW)).toEqual({
      status: 'invalid',
    });
    const result = await pollPairing(env.DB, env.ENC_KEY, pairing.code, pairing.secret, NOW);
    expect(result.status).toBe('paired');
    expect(await pollPairing(env.DB, env.ENC_KEY, pairing.code, pairing.secret, NOW + 1_000)).toEqual(result);
    expect(await pollPairing(env.DB, env.ENC_KEY, pairing.code, pairing.secret, NOW + 3 * 60_000)).toEqual({
      status: 'expired',
    });
    const token = result.status === 'paired' ? result.token : '';
    expect(await authenticateDisplay(env.DB, token, NOW)).toMatchObject({ name: 'TV', kind: 'tv' });
    await env.DB.prepare('UPDATE displays SET revoked_at = 1').run();
    expect(await authenticateDisplay(env.DB, token, NOW)).toBeNull();
  });
});
