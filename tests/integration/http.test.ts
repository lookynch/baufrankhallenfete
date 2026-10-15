import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.ts';
import type { Env } from '../../src/server/env.ts';
import { buzzerSignature } from '../../src/server/routes/buzzer.ts';
import { presenceToken } from '../../src/server/security/presence.ts';
import { totpCode } from '../../src/server/security/totp.ts';
import { saveSettings } from '../../src/server/services/settings.ts';
import { FakeSpotify, makeTrack } from '../helpers/fake-spotify.ts';
import { Clock, testEnv } from '../helpers/runtime.ts';

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
    expect(res.json.schemaVersion).toBe(2);
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
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
    const joined = await guest.request('POST', '/api/public/join', { json: { token, fingerprint: 'ua|de|390x844' } });
    expect(joined.json).toMatchObject({ joined: true, verified: false });
    expect(guest.cookies.has('__Host-fete')).toBe(true);

    h.clock.advance(5_000);
    await guest.request('GET', '/api/public/state');
    const state = await guest.request('GET', '/api/public/state');
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
