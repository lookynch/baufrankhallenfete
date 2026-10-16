import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.ts';
import type { Env } from '../../src/server/env.ts';
import { ipKeyHash, networkKey } from '../../src/server/security/ip.ts';
import { presenceToken } from '../../src/server/security/presence.ts';
import { saveSet } from '../../src/server/services/library.ts';
import { saveSettings } from '../../src/server/services/settings.ts';
import { castVote, type VoteInput } from '../../src/server/services/votes.ts';
import { createWish, decideWish, upvoteWish } from '../../src/server/services/wishes.ts';
import { defaultSettings, type Settings } from '../../src/shared/settings.ts';
import { createTestDb } from '../helpers/d1.ts';
import { FakeSpotify, makeTrack } from '../helpers/fake-spotify.ts';
import { Clock, testEnv } from '../helpers/runtime.ts';

const ORIGIN = 'https://fete.example';
const T0 = Date.UTC(2026, 10, 20, 17, 0, 0);
const NOW = 1_800_000_000_000;

const base = defaultSettings(0);
const settings: Settings = {
  ...base,
  security: { ...base.security, votesPerIpV4: 3, votesPerIpV6: 1, votesPerNetV6: 2 },
};

async function roundWithCandidates() {
  const db = createTestDb();
  await db.batch([
    db.prepare(
      "INSERT INTO songs (id, spotify_uri, title, artist, duration_ms, title_norm, artist_norm, created_at) VALUES (1, 'spotify:track:aaaaaaaaaa', 'A', 'X', 1, 'a', 'x', 0), (2, 'spotify:track:bbbbbbbbbb', 'B', 'X', 1, 'b', 'x', 0)",
    ),
    db.prepare("INSERT INTO rounds (id, seq, status, mood_level, opened_at) VALUES (1, 1, 'open', 2, 0)"),
    db.prepare(
      'INSERT INTO round_candidates (round_id, song_id, position, tiebreak) VALUES (1, 1, 1, 1), (1, 2, 2, 2)',
    ),
  ]);
  return db;
}

function vote(deviceId: string, ipKey: string, overrides: Partial<VoteInput> = {}): VoteInput {
  return {
    roundId: 1,
    songId: 1,
    deviceId,
    ipKey,
    netKey: ipKey,
    ipFamily: 'v6',
    now: 1,
    ...overrides,
  };
}

describe('IPv6-Netzschlüssel', () => {
  it('fasst /64-Netze eines /48 zusammen und lässt IPv4 unverändert', async () => {
    expect(networkKey('2a02:810d:4b3f:1200::1')).toBe('v6:2a02:810d:4b3f::/48');
    expect(networkKey('2a02:810d:4b3f:12ff:1:2:3:4')).toBe('v6:2a02:810d:4b3f::/48');
    expect(networkKey('203.0.113.7')).toBe('v4:203.0.113.7');
    expect(networkKey('::ffff:203.0.113.7')).toBe('v4:203.0.113.7');
    const a = await ipKeyHash('secret', '2a02:810d:4b3f:1200::1');
    const b = await ipKeyHash('secret', '2a02:810d:4b3f:1201::1');
    expect(a.hash).not.toBe(b.hash);
    expect(a.netHash).toBe(b.netHash);
    const v4 = await ipKeyHash('secret', '203.0.113.7');
    expect(v4.netHash).toBe(v4.hash);
  });
});

describe('Stimmen mit Netzlimit und Invalidierung', () => {
  it('begrenzt Stimmen pro IPv6-/48 über mehrere /64 hinweg, Stimmänderung bleibt erlaubt', async () => {
    const db = await roundWithCandidates();
    expect(await castVote(db, settings, vote('d1', 'p1', { netKey: 'net' }))).toBe('ok');
    expect(await castVote(db, settings, vote('d2', 'p2', { netKey: 'net' }))).toBe('ok');
    expect(await castVote(db, settings, vote('d3', 'p3', { netKey: 'net' }))).toBe('ip_limit');
    expect(await castVote(db, settings, vote('d1', 'p1', { netKey: 'net', songId: 2 }))).toBe('ok');
    expect(await castVote(db, settings, vote('d4', 'p4', { netKey: 'other' }))).toBe('ok');
  });

  it('wendet kein Netzlimit auf IPv4 an', async () => {
    const db = await roundWithCandidates();
    const v4 = (d: string, ip: string) => vote(d, ip, { ipFamily: 'v4', netKey: ip });
    expect(await castVote(db, settings, v4('d1', 'a'))).toBe('ok');
    expect(await castVote(db, settings, v4('d2', 'a'))).toBe('ok');
    expect(await castVote(db, settings, v4('d3', 'a'))).toBe('ok');
    expect(await castVote(db, settings, v4('d4', 'a'))).toBe('ip_limit');
  });

  it('gibt das IP-Kontingent nach einer Invalidierung nicht wieder frei', async () => {
    const db = await roundWithCandidates();
    expect(await castVote(db, settings, vote('d1', 'ip'))).toBe('ok');
    await db.prepare("UPDATE votes SET invalidated = 1 WHERE ip_key = 'ip'").run();
    expect(await castVote(db, settings, vote('d2', 'ip'))).toBe('ip_limit');
  });

  it('meldet erneute Stimmen eines invalidierten Geräts und lässt sie ungültig', async () => {
    const db = await roundWithCandidates();
    expect(await castVote(db, settings, vote('d1', 'ip'))).toBe('ok');
    await db.prepare("UPDATE votes SET invalidated = 1 WHERE device_id = 'd1'").run();
    expect(await castVote(db, settings, vote('d1', 'ip', { songId: 2 }))).toBe('vote_invalidated');
    const row = await db
      .prepare("SELECT song_id, invalidated FROM votes WHERE device_id = 'd1'")
      .first<{ song_id: number; invalidated: number }>();
    expect(row).toEqual({ song_id: 1, invalidated: 1 });
  });
});

describe('Wünsche', () => {
  async function setup() {
    const env = testEnv();
    const spotify = new FakeSpotify(() => NOW);
    for (let i = 0; i < 3; i++) spotify.add(makeTrack(i, 200_000, 'wish'));
    return { db: env.DB, spotify };
  }

  it('begrenzt +1 pro Netz-Schlüssel wie Stimmen', async () => {
    const { db, spotify } = await setup();
    const uri = makeTrack(0, 200_000, 'wish').uri;
    const created = await createWish(db, spotify, 'dev-a', uri, NOW);
    const setId = await saveSet(db, { name: 'S', starts_at: NOW, ends_at: NOW + 3_600_000, default_level: 3 }, NOW);
    await decideWish(db, created.id, { approve: true, setId, level: null }, 1, NOW);
    const network = { ipKey: 'ip-1', limit: 1 };
    expect(await upvoteWish(db, created.id, 'dev-b', NOW, network)).toBe(true);
    expect(await upvoteWish(db, created.id, 'dev-c', NOW, network)).toBe(false);
    expect(await upvoteWish(db, created.id, 'dev-c', NOW, { ipKey: 'ip-2', limit: 1 })).toBe(true);
    const merged = await createWish(db, spotify, 'dev-d', uri, NOW, network);
    expect(merged.merged).toBe(true);
    const count = await db
      .prepare('SELECT COUNT(*) AS n FROM wish_upvotes WHERE wish_id = ?1')
      .bind(created.id)
      .first<{ n: number }>();
    expect(count?.n).toBe(2);
  });

  it('deckelt Spotify-Track-Abfragen für unbekannte URIs global', async () => {
    const { db, spotify } = await setup();
    const lookup = spotify.track.bind(spotify);
    let calls = 0;
    spotify.track = (id) => {
      calls++;
      return lookup(id);
    };
    const results: string[] = [];
    for (let i = 0; i < 15; i++) {
      const uri = `spotify:track:unknown${String(i).padStart(6, '0')}`;
      results.push(
        await createWish(db, spotify, `dev-${i}`, uri, NOW).then(
          () => 'ok',
          (e: Error) => e.message,
        ),
      );
    }
    expect(calls).toBe(10);
    expect(results.slice(0, 10).every((r) => r === 'track_unavailable')).toBe(true);
    expect(results.slice(10).every((r) => r === 'limited')).toBe(true);
  });
});

class Harness {
  readonly clock = new Clock(T0);
  readonly env: Env;
  readonly spotify = new FakeSpotify(this.clock.now);
  readonly app = createApp({ now: this.clock.now, spotify: () => this.spotify });
  readonly pending: Promise<unknown>[] = [];

  constructor(overrides: Partial<Env> = {}) {
    this.env = testEnv(overrides);
  }

  async request(ip: string, cookie: string | null, method: string, path: string, json?: unknown) {
    const headers: Record<string, string> = { Host: 'fete.example', 'CF-Connecting-IP': ip };
    if (method !== 'GET') headers.Origin = ORIGIN;
    if (cookie) headers.Cookie = cookie;
    if (json !== undefined) headers['Content-Type'] = 'application/json';
    const response = await this.app.request(
      `${ORIGIN}${path}`,
      { method, headers, body: json === undefined ? undefined : JSON.stringify(json) },
      this.env,
      { waitUntil: (p: Promise<unknown>) => this.pending.push(p), passThroughOnException: () => {}, props: {} },
    );
    while (this.pending.length) await this.pending.shift();
    const setCookie = response.headers.getSetCookie()[0]?.split(';')[0] ?? cookie;
    return { status: response.status, json: (await response.json()) as Record<string, unknown>, cookie: setCookie };
  }

  async join(ip: string) {
    const token = await presenceToken('test-qr-secret-0123456789', this.clock.time);
    return this.request(ip, null, 'POST', '/api/public/join', { token });
  }
}

describe('Gast-Beitritt', () => {
  it('braucht nur den QR-Token und liefert keine Prüfstatus-Felder', async () => {
    const h = new Harness();
    const joined = await h.join('203.0.113.7');
    expect(joined.json).toEqual({ joined: true });
    const state = await h.request('203.0.113.7', joined.cookie, 'GET', '/api/public/state');
    expect(state.json.joined).toBe(true);
    expect(state.json).not.toHaveProperty('verified');
    expect(state.json).not.toHaveProperty('turnstileSiteKey');
  });

  it('ignoriert Felder alter Clients und speichert keine Gerätesignatur', async () => {
    const h = new Harness();
    const token = await presenceToken('test-qr-secret-0123456789', h.clock.time);
    const joined = await h.request('203.0.113.7', null, 'POST', '/api/public/join', {
      token,
      turnstile: 'alt',
      fingerprint: 'ua|de|390x844',
    });
    expect(joined.json).toEqual({ joined: true });
    expect(await h.env.DB.prepare('SELECT fp_hash FROM devices').first()).toEqual({ fp_hash: null });
    expect((await h.request('203.0.113.7', null, 'GET', '/api/public/config')).status).toBe(404);
  });
});

describe('Gast-Abfrageintervall', () => {
  it('richtet das nächste Polling am Rundenende aus statt dauerhaft alle 15 s', async () => {
    const h = new Harness();
    const db = h.env.DB;
    await saveSettings(db, 'voting', { startsAt: T0 - 60_000 }, T0, null);
    await db
      .prepare("INSERT INTO sets (name, starts_at, ends_at, default_level, created_at) VALUES ('Alles', ?1, ?2, 2, 0)")
      .bind(T0 - 3_600_000, T0 + 9 * 3_600_000)
      .run();
    for (let i = 0; i < 12; i++) {
      const t = makeTrack(i);
      await db
        .prepare(
          'INSERT INTO songs (spotify_uri, isrc, title, artist, duration_ms, title_norm, artist_norm, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?3, ?4, 0)',
        )
        .bind(t.uri, t.isrc, t.title, t.artist, t.durationMs)
        .run();
    }
    await db.prepare('INSERT INTO set_songs (set_id, song_id, added_at) SELECT 1, id, 0 FROM songs').run();

    const anonymous = await h.request('2a02:810d:aaaa:1::5', null, 'GET', '/api/public/state');
    expect(anonymous.json).toMatchObject({ joined: false, pollAfterMs: 300_000 });

    const joined = await h.join('2a02:810d:aaaa:1::5');
    h.clock.advance(60_000);
    await h.request('2a02:810d:aaaa:1::5', joined.cookie, 'GET', '/api/public/state');
    const state = await h.request('2a02:810d:aaaa:1::5', joined.cookie, 'GET', '/api/public/state');
    const round = state.json.round as { expectedCloseAt: number } | null;
    expect(round).not.toBeNull();
    const pollAfterMs = state.json.pollAfterMs as number;
    const untilEnd = round!.expectedCloseAt - h.clock.time;
    expect(pollAfterMs).toBeGreaterThanOrEqual(Math.min(300_000, untilEnd));
    expect(pollAfterMs).toBeLessThanOrEqual(300_000);
    expect(pollAfterMs).toBeGreaterThan(15_000);

    h.clock.time = round!.expectedCloseAt + 1_000;
    const ended = await h.request('2a02:810d:aaaa:1::5', joined.cookie, 'GET', '/api/public/state');
    expect(ended.json.pollAfterMs).toBeLessThanOrEqual(300_000);
    expect(ended.json.pollAfterMs).toBeGreaterThanOrEqual(3_000);
  });
});
