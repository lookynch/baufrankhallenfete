import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.ts';
import type { Env } from '../../src/server/env.ts';
import { verifyAccessJwt } from '../../src/server/security/access.ts';
import { hashPassword } from '../../src/server/security/password.ts';
import { totpCode } from '../../src/server/security/totp.ts';
import { FakeSpotify } from '../helpers/fake-spotify.ts';
import { Clock, testEnv } from '../helpers/runtime.ts';

const ORIGIN = 'https://fete.example';
const T0 = Date.UTC(2026, 10, 20, 17, 0, 0);
const PASSWORD = 'Lange sichere Passphrase 42';

class Harness {
  readonly clock = new Clock(T0);
  readonly env: Env;
  readonly spotify = new FakeSpotify(this.clock.now);
  readonly app = createApp({ now: this.clock.now, spotify: () => this.spotify });

  constructor(overrides: Partial<Env> = {}) {
    this.env = testEnv({ BOOTSTRAP_TOKEN: 'bootstrap-secret-token', ...overrides });
  }

  client(ip = '2a02:810d:4b3f:1200::1') {
    return new Client(this, ip);
  }

  code(secret: string) {
    this.clock.advance(30_000);
    return totpCode(secret, Math.floor(this.clock.time / 30_000));
  }

  async auditActions(): Promise<string[]> {
    const { results } = await this.env.DB.prepare('SELECT action FROM audit_log ORDER BY id').all<{ action: string }>();
    return results.map((r) => r.action);
  }
}

class Client {
  readonly cookies = new Map<string, string>();
  constructor(
    private readonly harness: Harness,
    private readonly ip: string,
  ) {}

  async request(method: string, path: string, json?: unknown) {
    const headers: Record<string, string> = { Host: 'fete.example', 'CF-Connecting-IP': this.ip };
    if (method !== 'GET') {
      headers.Origin = ORIGIN;
      headers['X-Requested-With'] = 'fete';
    }
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (json !== undefined) headers['Content-Type'] = 'application/json';
    const response = await this.harness.app.request(
      `${ORIGIN}${path}`,
      { method, headers, body: json === undefined ? undefined : JSON.stringify(json) },
      this.harness.env,
    );
    for (const cookie of response.headers.getSetCookie()) {
      const [name, ...value] = cookie.split(';')[0]!.split('=');
      if (/max-age=0/i.test(cookie)) this.cookies.delete(name!);
      else this.cookies.set(name!, value.join('='));
    }
    const text = await response.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = { text };
    }
    return { status: response.status, json: body };
  }
}

async function completeInvite(h: Harness, invitePath: unknown) {
  const client = h.client();
  const token = String(invitePath).split('#')[1]!;
  const setup = await client.request('POST', '/api/admin/auth/invite/setup', { token });
  if (setup.status !== 200) return { client, secret: '', status: setup.status, json: setup.json };
  const secret = String(setup.json.secret);
  const done = await client.request('POST', '/api/admin/auth/invite/complete', {
    token,
    password: PASSWORD,
    setupToken: setup.json.setupToken,
    code: await h.code(secret),
  });
  return { client, secret, status: done.status, json: done.json };
}

async function createOwner(h: Harness) {
  const boot = await h.client().request('POST', '/api/admin/auth/bootstrap', {
    token: 'bootstrap-secret-token',
    username: 'anna',
    displayName: 'Anna',
  });
  const done = await completeInvite(h, boot.json.invitePath);
  expect(done.status).toBe(200);
  return done;
}

async function invite(owner: Client, username: string, role: 'owner' | 'admin', reset?: boolean) {
  return owner.request('POST', '/api/admin/users/invite', { username, displayName: username, role, reset });
}

async function userRow(h: Harness, username: string) {
  return h.env.DB.prepare('SELECT id, role, disabled, password_hash FROM admin_users WHERE username = ?1')
    .bind(username)
    .first<{ id: number; role: string; disabled: number; password_hash: string }>();
}

describe('Einladungen und gesperrte Konten', () => {
  it('entwertet offene Einladungen beim Sperren und reaktiviert gesperrte Konten nicht', async () => {
    const h = new Harness();
    const { client: owner } = await createOwner(h);
    const first = await invite(owner, 'bob', 'admin');
    expect((await completeInvite(h, first.json.invitePath)).status).toBe(200);
    const bob = await userRow(h, 'bob');

    const reset = await invite(owner, 'bob', 'admin', true);
    expect(reset.status).toBe(200);
    expect((await owner.request('POST', `/api/admin/users/${bob!.id}/disable`)).status).toBe(200);
    const token = String(reset.json.invitePath).split('#')[1]!;
    const info = await h.client().request('POST', '/api/admin/auth/invite/info', { token });
    expect(info).toMatchObject({ status: 404, json: { error: 'invite_revoked' } });
    expect((await completeInvite(h, reset.json.invitePath)).json.error).toBe('invite_revoked');
    expect((await userRow(h, 'bob'))!.disabled).toBe(1);

    expect((await invite(owner, 'bob', 'admin', true)).json.error).toBe('user_disabled');
  });

  it('bricht den Abschluss ab, wenn das Konto nach der Einladung gesperrt wurde', async () => {
    const h = new Harness();
    const { client: owner } = await createOwner(h);
    const first = await invite(owner, 'bob', 'admin');
    await completeInvite(h, first.json.invitePath);
    const reset = await invite(owner, 'bob', 'admin', true);
    await h.env.DB.prepare("UPDATE admin_users SET disabled = 1 WHERE username = 'bob'").run();
    const done = await completeInvite(h, reset.json.invitePath);
    expect(done).toMatchObject({ status: 409, json: { error: 'user_disabled' } });
    expect((await userRow(h, 'bob'))!.disabled).toBe(1);
  });

  it('macht ältere Einladungen ungültig und erlaubt den Widerruf durch Owner', async () => {
    const h = new Harness();
    const { client: owner } = await createOwner(h);
    const older = await invite(owner, 'carl', 'admin');
    const newer = await invite(owner, 'Carl', 'admin');
    const olderToken = String(older.json.invitePath).split('#')[1]!;
    const newerToken = String(newer.json.invitePath).split('#')[1]!;
    expect((await h.client().request('POST', '/api/admin/auth/invite/info', { token: olderToken })).json.error).toBe(
      'invite_revoked',
    );
    expect((await h.client().request('POST', '/api/admin/auth/invite/info', { token: newerToken })).status).toBe(200);

    const revoked = await owner.request('POST', '/api/admin/users/invites/revoke', { username: 'CARL' });
    expect(revoked).toMatchObject({ status: 200, json: { revoked: 1 } });
    expect((await h.client().request('POST', '/api/admin/auth/invite/info', { token: newerToken })).json.error).toBe(
      'invite_revoked',
    );
    const users = await owner.request('GET', '/api/admin/users');
    const invites = users.json.invites as Array<{ username: string; revoked: number }>;
    expect(invites.filter((i) => i.username.toLowerCase() === 'carl').map((i) => i.revoked)).toEqual([1, 1]);
    expect(await h.auditActions()).toContain('invites_revoke');

    h.clock.advance(16 * 60_000);
    expect((await owner.request('POST', '/api/admin/users/invites/revoke', { username: 'carl' })).json.error).toBe(
      'reauth_required',
    );
  });
});

describe('Re-Invite bestehender Konten', () => {
  it('verlangt reset für bestehende Namen und schützt den letzten Owner', async () => {
    const h = new Harness();
    const { client: owner } = await createOwner(h);
    expect((await invite(owner, 'ANNA', 'owner')).json).toEqual({ error: 'username_exists' });
    expect((await invite(owner, 'anna', 'admin', true)).json).toEqual({ error: 'last_owner' });
    expect((await invite(owner, 'anna', 'owner', true)).status).toBe(200);
  });

  it('setzt Passwort und 2FA per Reset zurück, ohne Rolle oder Sperre zu verlieren', async () => {
    const h = new Harness();
    const { client: owner } = await createOwner(h);
    const first = await completeInvite(h, (await invite(owner, 'bob', 'admin')).json.invitePath);
    const reset = await completeInvite(h, (await invite(owner, 'BOB', 'admin', true)).json.invitePath);
    expect(reset.status).toBe(200);
    expect((await first.client.request('GET', '/api/admin/auth/me')).status).toBe(401);
    expect((await reset.client.request('GET', '/api/admin/auth/me')).json).toMatchObject({ username: 'bob' });
    expect(await userRow(h, 'bob')).toMatchObject({ role: 'admin', disabled: 0 });
  });

  it('stuft beim Abschluss nicht den letzten aktiven Owner herab', async () => {
    const h = new Harness();
    const { client: owner } = await createOwner(h);
    const bobInvite = await invite(owner, 'bob', 'owner');
    await completeInvite(h, bobInvite.json.invitePath);
    const demote = await invite(owner, 'anna', 'admin', true);
    expect(demote.status).toBe(200);
    const bob = await userRow(h, 'bob');
    expect((await owner.request('POST', `/api/admin/users/${bob!.id}/disable`)).status).toBe(200);
    const done = await completeInvite(h, demote.json.invitePath);
    expect(done).toMatchObject({ status: 409, json: { error: 'last_owner' } });
    expect((await userRow(h, 'anna'))!.role).toBe('owner');
  });
});

describe('CSV-Export', () => {
  it('exportiert Storno-Mengen als Zahl', async () => {
    const h = new Harness();
    const { client: owner } = await createOwner(h);
    const booked = await owner.request('POST', '/api/admin/ledger/entries', {
      kind: 'consumption',
      debitAccount: '4140',
      creditAccount: '3980',
      amountCents: 1890,
      quantity: 1,
      text: '-Kasten',
    });
    expect(booked.status).toBe(200);
    await owner.request('POST', `/api/admin/ledger/entries/${String(booked.json.id)}/reverse`, { reason: 'Fehldruck' });
    const csv = String((await owner.request('GET', '/api/admin/ledger/export.csv')).json.text);
    expect(csv).toContain(';-1;');
    expect(csv).toContain(";'-Kasten;");
  });
});

describe('Cloudflare Access', () => {
  it('sperrt den Adminbereich bei halber Konfiguration', async () => {
    const h = new Harness({ ACCESS_AUD: 'aud-123' });
    const res = await h.client().request('GET', '/api/admin/auth/me');
    expect(res).toMatchObject({ status: 503, json: { error: 'server_not_configured' } });
    expect((await h.client().request('GET', '/api/health')).status).toBe(200);
    const other = new Harness({ ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com' });
    expect((await other.client().request('GET', '/api/admin/auth/me')).status).toBe(503);
    const full = new Harness({ ACCESS_AUD: 'aud-123', ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com' });
    expect((await full.client().request('GET', '/api/admin/auth/me')).json.error).toBe('access_required');
  });

  it('meldet die Access-Konfiguration im Dashboard', async () => {
    const h = new Harness();
    const { client: owner } = await createOwner(h);
    const dashboard = (await owner.request('GET', '/api/admin/dashboard')).json;
    expect(dashboard.accessConfigured).toBe(false);
    expect(dashboard).not.toHaveProperty('turnstileConfigured');
  });

  async function keyPair(kid: string) {
    const pair = (await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
    return { kid, privateKey: pair.privateKey, jwk: { kid, kty: 'RSA', n: jwk.n!, e: jwk.e! } };
  }

  async function sign(key: Awaited<ReturnType<typeof keyPair>>, team: string, now: number) {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const head = `${encode({ alg: 'RS256', kid: key.kid })}.${encode({ aud: 'aud-1', iss: `https://${team}`, exp: Math.floor(now / 1000) + 600 })}`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, new TextEncoder().encode(head));
    return `${head}.${Buffer.from(signature).toString('base64url')}`;
  }

  it('lädt die Schlüssel bei unbekannter kid gedrosselt nach', async () => {
    const team = 'rotation.cloudflareaccess.com';
    const [a, b, c] = await Promise.all([keyPair('a'), keyPair('b'), keyPair('c')]);
    let published = [a.jwk];
    let fetches = 0;
    const fetcher = (async () => {
      fetches += 1;
      return Response.json({ keys: published });
    }) as unknown as typeof fetch;

    expect(await verifyAccessJwt(await sign(a, team, T0), team, 'aud-1', T0, fetcher)).toBe(true);
    published = [a.jwk, b.jwk];
    const later = T0 + 120_000;
    expect(await verifyAccessJwt(await sign(b, team, later), team, 'aud-1', later, fetcher)).toBe(true);
    expect(fetches).toBe(2);
    expect(await verifyAccessJwt(await sign(c, team, later), team, 'aud-1', later + 1_000, fetcher)).toBe(false);
    expect(fetches).toBe(2);
    published = [b.jwk, c.jwk];
    const muchLater = later + 61_000;
    expect(await verifyAccessJwt(await sign(c, team, muchLater), team, 'aud-1', muchLater, fetcher)).toBe(true);
    expect(fetches).toBe(3);
  });
});

describe('Audit und TOTP-Limits', () => {
  it('protokolliert Reauth, Logout und das Beenden eigener Sessions', async () => {
    const h = new Harness();
    const { client: owner, secret } = await createOwner(h);
    expect((await owner.request('POST', '/api/admin/auth/reauth', { code: '000000' })).status).toBe(401);
    expect((await owner.request('POST', '/api/admin/auth/reauth', { code: await h.code(secret) })).status).toBe(200);
    expect((await owner.request('POST', '/api/admin/sessions/revoke-mine')).status).toBe(200);
    expect((await owner.request('POST', '/api/admin/auth/logout')).status).toBe(200);
    expect(await h.auditActions()).toEqual(
      expect.arrayContaining(['reauth_failed', 'reauth', 'sessions_revoke_mine', 'logout']),
    );
  });

  it('zählt nur Fehlversuche und trennt Reauth vom Login-Limit', async () => {
    const h = new Harness();
    const { client: owner, secret } = await createOwner(h);
    let ip = 0;
    const login = async () =>
      String(
        (
          await h
            .client(`198.51.100.${++ip}`)
            .request('POST', '/api/admin/auth/login', { username: 'anna', password: PASSWORD })
        ).json.ticket,
      );
    for (let i = 0; i < 7; i++) {
      const ok = await h.client().request('POST', '/api/admin/auth/verify', {
        ticket: await login(),
        code: await h.code(secret),
      });
      expect(ok.status).toBe(200);
    }

    const attackerTicket = await login();
    const statuses = [];
    for (let i = 0; i < 7; i++) {
      statuses.push(
        (await h.client().request('POST', '/api/admin/auth/verify', { ticket: attackerTicket, code: '000000' })).status,
      );
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 401, 429]);
    expect((await owner.request('POST', '/api/admin/auth/reauth', { code: await h.code(secret) })).status).toBe(200);

    for (let i = 0; i < 6; i++) await owner.request('POST', '/api/admin/auth/reauth', { code: '000000' });
    expect((await owner.request('POST', '/api/admin/auth/reauth', { code: '000000' })).status).toBe(429);
  });
});

describe('Passwort-Rehash', () => {
  it('rehasht nur, wenn beide Ableitungen ins CPU-Budget passen', async () => {
    const h = new Harness();
    await createOwner(h);
    const setHash = async (iterations: number) => {
      const hash = await hashPassword(PASSWORD, h.env.SESSION_PEPPER, iterations);
      await h.env.DB.prepare("UPDATE admin_users SET password_hash = ?1 WHERE username = 'anna'").bind(hash).run();
      return hash;
    };
    const login = () => h.client().request('POST', '/api/admin/auth/login', { username: 'anna', password: PASSWORD });

    const expensive = await setHash(25_000);
    expect((await login()).status).toBe(200);
    expect((await userRow(h, 'anna'))!.password_hash).toBe(expensive);

    await setHash(15_000);
    expect((await login()).status).toBe(200);
    expect((await userRow(h, 'anna'))!.password_hash).toMatch(/^pbkdf2\$10000\$/);
  });
});
