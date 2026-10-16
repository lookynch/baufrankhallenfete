import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/server/app.ts';
import type { Env } from '../../src/server/env.ts';
import { buzzerSignature } from '../../src/server/routes/buzzer.ts';
import { presenceToken } from '../../src/server/security/presence.ts';
import { totpCode } from '../../src/server/security/totp.ts';
import { setKv } from '../../src/server/services/kv.ts';
import { saveSettings } from '../../src/server/services/settings.ts';
import { tick } from '../../src/server/services/tick.ts';
import { FakeSpotify, makeTrack } from '../helpers/fake-spotify.ts';
import { Clock, testEnv, testRuntime } from '../helpers/runtime.ts';

const ORIGIN = 'https://fete.example';
const T0 = Date.UTC(2026, 10, 20, 17, 0, 0);

class Client {
  readonly cookies = new Map<string, string>();
  constructor(
    private readonly harness: Harness,
    private readonly ip = '2a02:810d:4b3f:1200::1',
  ) {}

  async request(
    method: string,
    path: string,
    options: { json?: unknown; headers?: Record<string, string>; raw?: string } = {},
  ) {
    const headers: Record<string, string> = {
      Host: 'fete.example',
      'CF-Connecting-IP': this.ip,
      ...(method !== 'GET' ? { Origin: ORIGIN } : {}),
      ...(path.startsWith('/api/admin') && method !== 'GET' ? { 'X-Requested-With': 'fete' } : {}),
      ...options.headers,
    };
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    let bodyText = options.raw;
    if (options.json !== undefined) {
      bodyText = JSON.stringify(options.json);
      headers['Content-Type'] = 'application/json';
    }
    const response = await this.harness.app.request(
      `${ORIGIN}${path}`,
      { method, headers, body: bodyText },
      this.harness.env,
      { waitUntil: (p: Promise<unknown>) => this.harness.pending.push(p), passThroughOnException: () => {}, props: {} },
    );
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const [name, ...value] = pair!.split('=');
      if (/max-age=0/i.test(cookie)) this.cookies.delete(name!);
      else this.cookies.set(name!, value.join('='));
    }
    await this.harness.settle();
    const text = await response.text();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = { text };
    }
    return { status: response.status, json, headers: response.headers };
  }
}

class Harness {
  readonly clock = new Clock(T0);
  readonly env: Env;
  readonly spotify = new FakeSpotify(this.clock.now);
  readonly app = createApp({ now: this.clock.now, spotify: () => this.spotify });
  readonly pending: Promise<unknown>[] = [];

  constructor(overrides: Partial<Env> = {}) {
    this.env = testEnv({ BOOTSTRAP_TOKEN: 'bootstrap-secret-token', ...overrides });
  }

  async settle() {
    while (this.pending.length) await this.pending.shift();
  }

  client(ip?: string) {
    return new Client(this, ip);
  }
}

async function createOwner(h: Harness, username = 'anna') {
  const client = h.client();
  const boot = await client.request('POST', '/api/admin/auth/bootstrap', {
    json: { token: 'bootstrap-secret-token', username, displayName: 'Anna' },
  });
  expect(boot.status).toBe(200);
  const inviteToken = String(boot.json.invitePath).split('#')[1]!;
  const setup = await client.request('POST', '/api/admin/auth/invite/setup', { json: { token: inviteToken } });
  const secret = String(setup.json.secret);
  const code = await totpCode(secret, Math.floor(h.clock.time / 30_000));
  const done = await client.request('POST', '/api/admin/auth/invite/complete', {
    json: { token: inviteToken, password: 'Lange sichere Passphrase 42', setupToken: setup.json.setupToken, code },
  });
  expect(done.status).toBe(200);
  expect(done.json.recoveryCodes).toHaveLength(10);
  return { client, secret, recoveryCodes: done.json.recoveryCodes as string[] };
}

describe('Grundlagen', () => {
  it('liefert Health mit Schema-Version und Sicherheits-Headern', async () => {
    const h = new Harness();
    const res = await h.client().request('GET', '/api/health');
    expect(res.status).toBe(200);
    expect(res.json.schemaVersion).toBe(3);
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('Content-Security-Policy')).not.toContain('challenges.cloudflare.com');
    expect(res.headers.get('Content-Security-Policy')).toContain("img-src 'self' data:;");
    expect(res.headers.get('Content-Security-Policy')).not.toContain('https:');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const missing = await h.client().request('GET', '/api/nope');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('verweigert den Betrieb ohne Pflicht-Secrets', async () => {
    const h = new Harness({ QR_SECRET: '' });
    expect((await h.client().request('GET', '/api/health')).status).toBe(503);
  });
});

describe('Admin-Authentifizierung', () => {
  let h: Harness;
  beforeEach(() => {
    h = new Harness();
  });

  it('führt Bootstrap, Einladung, Login und 2FA durch', async () => {
    const { secret, recoveryCodes } = await createOwner(h);
    const again = await h.client().request('POST', '/api/admin/auth/bootstrap', {
      json: { token: 'bootstrap-secret-token', username: 'evil', displayName: 'Evil' },
    });
    expect(again.status).toBe(409);

    const browser = h.client();
    expect((await browser.request('GET', '/api/admin/auth/me')).status).toBe(401);
    const wrong = await browser.request('POST', '/api/admin/auth/login', {
      json: { username: 'anna', password: 'falsch-falsch-falsch' },
    });
    expect(wrong.status).toBe(401);
    const login = await browser.request('POST', '/api/admin/auth/login', {
      json: { username: 'anna', password: 'Lange sichere Passphrase 42' },
    });
    expect(login.status).toBe(200);
    h.clock.advance(30_000);
    const code = await totpCode(secret, Math.floor(h.clock.time / 30_000));
    expect(
      (await browser.request('POST', '/api/admin/auth/verify', { json: { ticket: login.json.ticket, code } })).status,
    ).toBe(200);
    const me = await browser.request('GET', '/api/admin/auth/me');
    expect(me.json).toMatchObject({ username: 'anna', role: 'owner', recoveryCodesLeft: 10 });

    const replay = h.client();
    const login2 = await replay.request('POST', '/api/admin/auth/login', {
      json: { username: 'anna', password: 'Lange sichere Passphrase 42' },
    });
    expect(
      (await replay.request('POST', '/api/admin/auth/verify', { json: { ticket: login2.json.ticket, code } })).status,
    ).toBe(401);
    const viaRecovery = await replay.request('POST', '/api/admin/auth/verify', {
      json: { ticket: login2.json.ticket, recoveryCode: recoveryCodes[0] },
    });
    expect(viaRecovery.status).toBe(200);
  });

  it('blockiert CSRF, fehlende Reauth und Brute-Force', async () => {
    const { client, secret } = await createOwner(h);
    const noHeader = await client.request('POST', '/api/admin/users/invite', {
      json: { username: 'bob', displayName: 'Bob', role: 'admin' },
      headers: { 'X-Requested-With': '' },
    });
    expect(noHeader.status).toBe(403);
    const foreign = await client.request('POST', '/api/admin/users/invite', {
      json: { username: 'bob', displayName: 'Bob', role: 'admin' },
      headers: { Origin: 'https://evil.example' },
    });
    expect(foreign.json.error).toBe('csrf_check_failed');

    h.clock.advance(16 * 60_000);
    const stale = await client.request('POST', '/api/admin/users/invite', {
      json: { username: 'bob', displayName: 'Bob', role: 'admin' },
    });
    expect(stale.json.error).toBe('reauth_required');
    const code = await totpCode(secret, Math.floor(h.clock.time / 30_000));
    expect((await client.request('POST', '/api/admin/auth/reauth', { json: { code } })).status).toBe(200);
    const invite = await client.request('POST', '/api/admin/users/invite', {
      json: { username: 'bob', displayName: 'Bob', role: 'admin' },
    });
    expect(invite.status).toBe(200);

    const attacker = h.client('198.51.100.9');
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (
          await attacker.request('POST', '/api/admin/auth/login', {
            json: { username: 'anna', password: `falsch-${i}-xxxxxx` },
          })
        ).status,
      );
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    const owner = h.client('203.0.113.50');
    expect(
      (
        await owner.request('POST', '/api/admin/auth/login', {
          json: { username: 'anna', password: 'Lange sichere Passphrase 42' },
        })
      ).status,
    ).toBe(200);
  });

  it('begrenzt Login-Versuche pro IPv6-/48 auch bei wechselnden /64', async () => {
    const statuses = [];
    for (let i = 0; i < 61; i++) {
      const res = await h.client(`2001:db8:77:${i.toString(16)}::1`).request('POST', '/api/admin/auth/login', {
        json: { username: `user${i}`, password: 'falsch-falsch-falsch' },
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 60).every((s) => s === 401)).toBe(true);
    expect(statuses[60]).toBe(429);
    const otherNet = await h.client('2001:db8:78::1').request('POST', '/api/admin/auth/login', {
      json: { username: 'user0', password: 'falsch-falsch-falsch' },
    });
    expect(otherNet.status).toBe(401);
  });

  it('beendet Sessions nach Inaktivität', async () => {
    const { client } = await createOwner(h);
    expect((await client.request('GET', '/api/admin/auth/me')).status).toBe(200);
    h.clock.advance(2 * 3_600_000 + 1000);
    expect((await client.request('GET', '/api/admin/auth/me')).status).toBe(401);
  });
});

describe('Buzzer-API', () => {
  async function signed(
    h: Harness,
    path: string,
    payload: unknown,
    timestamp = h.clock.time,
    secret = 'test-buzzer-secret-0123456789',
  ) {
    const raw = JSON.stringify(payload);
    const signature = await buzzerSignature(secret, 'POST', path, String(timestamp), raw);
    return h.client('10.0.0.5').request('POST', path, {
      raw,
      headers: {
        'X-Fete-Agent': 'bar-pc',
        'X-Fete-Timestamp': String(timestamp),
        'X-Fete-Signature': signature,
        Origin: '',
      },
    });
  }

  it('bucht signierte Drücke genau einmal und lehnt Fälschungen ab', async () => {
    const h = new Harness();
    await saveSettings(h.env.DB, 'event', { startsAt: T0, endsAt: T0 + 6 * 3_600_000 }, T0, null);
    const press = {
      event_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      pressed_at: T0,
      source_code: '5393',
      agent_id: 'bar-pc',
    };
    const first = await signed(h, '/api/buzzer/press', press);
    expect(first.json).toMatchObject({ status: 'accepted', booking_no: 'BF-0001' });
    expect((await signed(h, '/api/buzzer/press', press)).json.status).toBe('duplicate');
    expect((await signed(h, '/api/buzzer/press', press, h.clock.time, 'falsch')).status).toBe(401);
    const stale = await signed(h, '/api/buzzer/press', press, h.clock.time - 120_000);
    expect(stale.json).toMatchObject({ error: 'stale_timestamp', server_time: h.clock.time });
    const old = await signed(h, '/api/buzzer/press', {
      ...press,
      event_id: '8c9e6679-7425-40de-944b-e07fc1f90ae7',
      pressed_at: T0 - 5 * 3_600_000,
    });
    expect(old.status).toBe(422);
    const beat = await signed(h, '/api/buzzer/heartbeat', {
      agent_id: 'bar-pc',
      sent_at: h.clock.time,
      queue_length: 0,
      serial_ok: true,
    });
    expect(beat.json).toMatchObject({ ok: true, server_time: h.clock.time });
  });
});

describe('Displays und Gäste', () => {
  it('koppelt Displays nur über Admin-Freigabe und liefert TV-Zustand mit QR-Token', async () => {
    const h = new Harness();
    const { client: admin } = await createOwner(h);
    const tv = h.client('2a02:810d::99');
    expect((await tv.request('GET', '/api/display/state')).status).toBe(401);
    const start = await tv.request('POST', '/api/display/pair/start');
    expect(start.json.code).toMatch(/^\d{6}$/);
    expect(
      (
        await tv.request('POST', '/api/display/pair/poll', {
          json: { code: start.json.code, secret: start.json.secret },
        })
      ).json.status,
    ).toBe('pending');
    const wrongSecret = await tv.request('POST', '/api/display/pair/poll', {
      json: { code: start.json.code, secret: 'x'.repeat(32) },
    });
    expect(wrongSecret.json.status).toBe('expired');
    expect(
      (
        await admin.request('POST', '/api/admin/displays/claim', {
          json: { code: start.json.code, name: 'TV Halle', kind: 'tv' },
        })
      ).status,
    ).toBe(200);
    const paired = await tv.request('POST', '/api/display/pair/poll', {
      json: { code: start.json.code, secret: start.json.secret },
    });
    expect(paired.json).toMatchObject({ status: 'paired', kind: 'tv' });
    const state = await tv.request('GET', '/api/display/state');
    expect(state.status).toBe(200);
    expect(String((state.json.presence as { token: string }).token)).toMatch(/^[A-Z2-7]{8}$/);
  });

  it('lässt Gäste nur mit QR-Token beitreten und abstimmen', async () => {
    const h = new Harness();
    await saveSettings(h.env.DB, 'voting', { startsAt: T0 - 60_000 }, T0, null);
    const db = h.env.DB;
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

    const guest = h.client('2a02:810d:aaaa:1::5');
    expect((await guest.request('POST', '/api/public/join', { json: {} })).json.error).toBe('qr_expired');
    expect((await guest.request('POST', '/api/public/join', { json: { token: 'AAAAAAAA' } })).status).toBe(403);
    const token = await presenceToken('test-qr-secret-0123456789', h.clock.time);
    const joined = await guest.request('POST', '/api/public/join', { json: { token } });
    expect(joined.json).toEqual({ joined: true });
    expect(guest.cookies.has('__Host-fete')).toBe(true);

    h.clock.advance(5_000);
    await guest.request('GET', '/api/public/state');
    const state = await guest.request('GET', '/api/public/state');
    expect(state.json.joined).toBe(true);
    const round = state.json.round as { id: number; candidates: Array<{ songId: number; votes?: number }> };
    expect(round.candidates.length).toBeGreaterThanOrEqual(4);
    expect(round.candidates[0]).not.toHaveProperty('votes');
    const vote = await guest.request('POST', '/api/public/vote', {
      json: { roundId: round.id, songId: round.candidates[0]!.songId },
    });
    expect(vote.status).toBe(200);

    const sameNetwork = h.client('2a02:810d:aaaa:1::77');
    await sameNetwork.request('POST', '/api/public/join', { json: { token } });
    const blocked = await sameNetwork.request('POST', '/api/public/vote', {
      json: { roundId: round.id, songId: round.candidates[1]!.songId },
    });
    expect(blocked.json.error).toBe('ip_limit');

    const csrf = await guest.request('POST', '/api/public/vote', {
      json: { roundId: round.id, songId: round.candidates[1]!.songId },
      headers: { Origin: 'https://evil.example' },
    });
    expect(csrf.status).toBe(403);
  });
});

describe('Cover-Proxy', () => {
  const id = 'ab67616d0000b2730123456789abcdef01234567';
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lehnt ungültige IDs ohne Abruf bei Spotify ab', async () => {
    const upstream = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', upstream);
    const client = new Harness().client();
    for (const path of ['/api/cover/xyz', `/api/cover/${id.toUpperCase()}`, `/api/cover/${id}0`]) {
      const res = await client.request('GET', path);
      expect(res.status).toBe(404);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it('liefert Cover über den eigenen Server mit privatem Cache und Sicherheits-Headern', async () => {
    const upstream = vi.fn<typeof fetch>(
      async () => new Response(new Uint8Array([255, 216, 255]), { headers: { 'Content-Type': 'image/jpeg' } }),
    );
    vi.stubGlobal('fetch', upstream);
    const client = new Harness().client();
    client.cookies.set('__Host-fete', 'geheim');
    const res = await client.request('GET', `/api/cover/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=86400, immutable');
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(upstream).toHaveBeenCalledTimes(1);
    const [url, init] = upstream.mock.calls[0]!;
    expect(String(url)).toBe(`https://i.scdn.co/image/${id}`);
    expect(init?.headers).toEqual({ Accept: 'image/*' });

    upstream.mockResolvedValueOnce(new Response('down', { status: 503 }));
    const failed = await client.request('GET', `/api/cover/${id}`);
    expect(failed.status).toBe(502);
    expect(failed.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('Budget-Wächter für Gast-Cover', () => {
  it('blendet Cover in Zustand, Wünschen und Suche ab 80 % aus', async () => {
    const h = new Harness();
    const db = h.env.DB;
    const cover = (i: number) => `https://i.scdn.co/image/ab67616d0000b273${String(i).padStart(24, '0')}`;
    await saveSettings(db, 'voting', { startsAt: T0 - 60_000 }, T0, null);
    await db
      .prepare("INSERT INTO sets (name, starts_at, ends_at, default_level, created_at) VALUES ('Alles', ?1, ?2, 2, 0)")
      .bind(T0 - 3_600_000, T0 + 9 * 3_600_000)
      .run();
    for (let i = 0; i < 12; i++) {
      const t = { ...makeTrack(i), imageUrl: cover(i) };
      h.spotify.add(t);
      await db
        .prepare(
          'INSERT INTO songs (spotify_uri, isrc, title, artist, image_url, duration_ms, title_norm, artist_norm, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?3, ?4, 0)',
        )
        .bind(t.uri, t.isrc, t.title, t.artist, t.imageUrl, t.durationMs)
        .run();
    }
    await db.prepare('INSERT INTO set_songs (set_id, song_id, added_at) SELECT 1, id, 0 FROM songs').run();
    const wish = { ...makeTrack(0, 200_000, 'wish'), imageUrl: cover(99) };
    h.spotify.add(wish);
    h.spotify.current = { uri: makeTrack(0).uri, startedAt: T0, pausedAt: null };

    const guest = h.client('2a02:810d:aaaa:1::5');
    const token = await presenceToken('test-qr-secret-0123456789', h.clock.time);
    expect((await guest.request('POST', '/api/public/join', { json: { token } })).status).toBe(200);
    expect((await guest.request('POST', '/api/public/wishes', { json: { uri: wish.uri } })).status).toBe(200);
    h.clock.advance(5_000);
    await tick(testRuntime(h.env, h.clock, h.spotify), { force: true });

    async function guestCovers(fraction: number) {
      await setKv(
        db,
        'request_budget',
        { requestsToday: fraction * 100_000, fraction, fetchedAt: h.clock.time, error: null },
        h.clock.time,
      );
      const state = await guest.request('GET', '/api/public/state');
      const wishes = await guest.request('GET', '/api/public/wishes');
      const search = await guest.request('GET', '/api/public/search?q=song');
      return [
        (state.json.nowPlaying as { imageUrl: string | null }).imageUrl,
        ...(state.json.round as { candidates: Array<{ imageUrl: string | null }> }).candidates.map((c) => c.imageUrl),
        ...(wishes.json.wishes as Array<{ image_url: string | null }>).map((w) => w.image_url),
        ...(search.json.tracks as Array<{ imageUrl: string | null }>).map((t) => t.imageUrl),
      ];
    }

    const normal = await guestCovers(0.79);
    expect(normal.length).toBeGreaterThan(10);
    expect(normal.every((url) => url?.startsWith('https://i.scdn.co/image/'))).toBe(true);
    expect(normal).toContain(cover(99));
    const throttled = await guestCovers(0.85);
    expect(throttled).toHaveLength(normal.length);
    expect(throttled.every((url) => url === null)).toBe(true);
  });
});
