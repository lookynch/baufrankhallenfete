import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.ts';
import type { Env } from '../../src/server/env.ts';
import { totpCode } from '../../src/server/security/totp.ts';
import { SoftwareAuthenticator } from '../helpers/authenticator.ts';
import { FakeSpotify } from '../helpers/fake-spotify.ts';
import { Clock, testEnv } from '../helpers/runtime.ts';

const ORIGIN = 'https://fete.example';
const T0 = Date.UTC(2026, 10, 20, 17, 0, 0);
const PASSWORD = 'Lange sichere Passphrase 42';

interface PasskeyRow {
  id: number;
  name: string;
}

class Harness {
  readonly clock = new Clock(T0);
  readonly env: Env;
  readonly spotify = new FakeSpotify(this.clock.now);
  readonly app = createApp({ now: this.clock.now, spotify: () => this.spotify });

  constructor(overrides: Partial<Env> = {}) {
    this.env = testEnv({ BOOTSTRAP_TOKEN: 'bootstrap-secret-token', WEBAUTHN_ORIGIN: ORIGIN, ...overrides });
  }

  client() {
    return new Client(this);
  }

  async auditActions(): Promise<string[]> {
    const { results } = await this.env.DB.prepare('SELECT action FROM audit_log ORDER BY id').all<{ action: string }>();
    return results.map((r) => r.action);
  }
}

class Client {
  readonly cookies = new Map<string, string>();
  constructor(private readonly harness: Harness) {}

  async request(method: string, path: string, json?: unknown) {
    const headers: Record<string, string> = { Host: 'fete.example', 'CF-Connecting-IP': '2a02:810d:4b3f:1200::1' };
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
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }
}

function tokenOf(invitePath: unknown): string {
  return String(invitePath).split('#')[1]!;
}

async function acceptWithPasskey(h: Harness, token: string, authenticator = new SoftwareAuthenticator(ORIGIN)) {
  const client = h.client();
  const options = await client.request('POST', '/api/admin/auth/invite/passkey/options', { token });
  if (options.status !== 200) return { client, authenticator, ...options };
  const credential = await authenticator.create(options.json as never);
  const done = await client.request('POST', '/api/admin/auth/invite/passkey/complete', { token, credential });
  return { client, authenticator, ...done };
}

async function bootstrapWithPasskey(h: Harness) {
  const boot = await h.client().request('POST', '/api/admin/auth/bootstrap', {
    token: 'bootstrap-secret-token',
    username: 'anna',
    displayName: 'Anna',
  });
  const owner = await acceptWithPasskey(h, tokenOf(boot.json.invitePath));
  expect(owner.status).toBe(200);
  return owner;
}

async function login(h: Harness, authenticator: SoftwareAuthenticator) {
  const client = h.client();
  const options = await client.request('POST', '/api/admin/auth/passkey/options', {});
  const credential = await authenticator.get(options.json as never);
  const result = await client.request('POST', '/api/admin/auth/passkey/verify', { credential });
  return { client, ...result };
}

async function reauth(client: Client, authenticator: SoftwareAuthenticator) {
  const options = await client.request('POST', '/api/admin/auth/reauth/passkey/options', {});
  const credential = await authenticator.get(options.json as never);
  return client.request('POST', '/api/admin/auth/reauth/passkey', { credential });
}

async function invite(h: Harness, owner: Client, username: string, reset = false) {
  const res = await owner.request('POST', '/api/admin/users/invite', {
    username,
    displayName: username,
    role: 'admin',
    reset,
  });
  expect(res.status).toBe(200);
  return tokenOf(res.json.invitePath);
}

describe('Passkey-Einrichtung per Einladung', () => {
  it('richtet den ersten Owner nur mit Passkey ein', async () => {
    const h = new Harness();
    const { client } = await bootstrapWithPasskey(h);
    const me = await client.request('GET', '/api/admin/auth/me');
    expect(me.json).toMatchObject({
      username: 'anna',
      role: 'owner',
      hasPassword: false,
      hasTotp: false,
      passkeyCount: 1,
      recoveryCodesLeft: 0,
    });
    expect(await h.auditActions()).toContain('invite_completed_passkey');
  });

  it('verweigert Passwort-Login und TOTP für reine Passkey-Konten', async () => {
    const h = new Harness();
    const { client } = await bootstrapWithPasskey(h);
    const res = await h.client().request('POST', '/api/admin/auth/login', { username: 'anna', password: '' });
    expect(res).toMatchObject({ status: 401, json: { error: 'invalid_credentials' } });
    const totp = await client.request('POST', '/api/admin/auth/reauth', { code: '123456' });
    expect(totp).toMatchObject({ status: 401, json: { error: 'invalid_code' } });
  });

  it('lässt die Einladung bei bereits registriertem Passkey unverbraucht', async () => {
    const h = new Harness();
    const { client: owner } = await bootstrapWithPasskey(h);
    const token = await invite(h, owner, 'bob');
    const options = await h.client().request('POST', '/api/admin/auth/invite/passkey/options', { token });
    const credential = await new SoftwareAuthenticator(ORIGIN).create(options.json as never);
    await h.env.DB.prepare('UPDATE admin_passkeys SET credential_id = ?1').bind(credential.id).run();
    const done = await h.client().request('POST', '/api/admin/auth/invite/passkey/complete', { token, credential });
    expect(done).toMatchObject({ status: 409, json: { error: 'passkey_exists' } });
    expect((await h.client().request('POST', '/api/admin/auth/invite/info', { token })).status).toBe(200);
  });

  it('lehnt fremde Origins, fehlende Nutzerverifikation und wiederverwendete Challenges ab', async () => {
    const h = new Harness();
    const boot = await h.client().request('POST', '/api/admin/auth/bootstrap', {
      token: 'bootstrap-secret-token',
      username: 'anna',
      displayName: 'Anna',
    });
    const token = tokenOf(boot.json.invitePath);
    const foreign = await acceptWithPasskey(h, token, new SoftwareAuthenticator('https://evil.example'));
    expect(foreign).toMatchObject({ status: 422, json: { error: 'passkey_failed' } });
    const noVerification = await acceptWithPasskey(h, token, new SoftwareAuthenticator(ORIGIN, 0x01));
    expect(noVerification).toMatchObject({ status: 422, json: { error: 'passkey_failed' } });

    const client = h.client();
    const options = await client.request('POST', '/api/admin/auth/invite/passkey/options', { token });
    const credential = await new SoftwareAuthenticator(ORIGIN).create(options.json as never);
    expect(
      (await client.request('POST', '/api/admin/auth/invite/passkey/complete', { token, credential })).status,
    ).toBe(200);
    const replay = await client.request('POST', '/api/admin/auth/invite/passkey/complete', { token, credential });
    expect(replay.status).toBe(404);
  });

  it('ersetzt beim Reset alle Passkeys und behält die WebAuthn-Kennung', async () => {
    const h = new Harness();
    const { client: owner } = await bootstrapWithPasskey(h);
    const bob = await acceptWithPasskey(h, await invite(h, owner, 'bob'));
    const handle = () =>
      h.env.DB.prepare("SELECT webauthn_user_id FROM admin_users WHERE username = 'bob'").first<{
        webauthn_user_id: string;
      }>();
    const before = await handle();
    const reset = await acceptWithPasskey(h, await invite(h, owner, 'bob', true));
    expect(reset.status).toBe(200);
    expect(await handle()).toEqual(before);
    expect((await bob.client.request('GET', '/api/admin/auth/me')).status).toBe(401);
    expect((await login(h, bob.authenticator)).json.error).toBe('passkey_failed');
    expect((await login(h, reset.authenticator)).status).toBe(200);
  });

  it('meldet fehlende Konfiguration', async () => {
    const h = new Harness({ WEBAUTHN_ORIGIN: undefined });
    const res = await h.client().request('POST', '/api/admin/auth/passkey/options', {});
    expect(res).toMatchObject({ status: 503, json: { error: 'passkeys_unavailable' } });
  });
});

describe('Passkey-Anmeldung', () => {
  it('meldet per Passkey an und verbraucht jede Challenge nur einmal', async () => {
    const h = new Harness();
    const { authenticator } = await bootstrapWithPasskey(h);
    const client = h.client();
    const options = await client.request('POST', '/api/admin/auth/passkey/options', {});
    expect(options.json).toMatchObject({ rpId: 'fete.example', userVerification: 'required', allowCredentials: [] });
    const credential = await authenticator.get(options.json as never);
    expect((await client.request('POST', '/api/admin/auth/passkey/verify', { credential })).status).toBe(200);
    expect((await client.request('GET', '/api/admin/auth/me')).json.username).toBe('anna');
    const replay = await h.client().request('POST', '/api/admin/auth/passkey/verify', { credential });
    expect(replay).toMatchObject({ status: 422, json: { error: 'challenge_expired' } });
    expect(await h.auditActions()).toContain('login_passkey');
  });

  it('lehnt abgelaufene Challenges, fremde Origins und gesperrte Konten ab', async () => {
    const h = new Harness();
    const { client: owner, authenticator } = await bootstrapWithPasskey(h);
    const client = h.client();
    const options = await client.request('POST', '/api/admin/auth/passkey/options', {});
    h.clock.advance(5 * 60_000 + 1);
    const late = await client.request('POST', '/api/admin/auth/passkey/verify', {
      credential: await authenticator.get(options.json as never),
    });
    expect(late.json.error).toBe('challenge_expired');

    const fresh = await client.request('POST', '/api/admin/auth/passkey/options', {});
    const foreign = await client.request('POST', '/api/admin/auth/passkey/verify', {
      credential: await authenticator.get(fresh.json as never, 'https://evil.example'),
    });
    expect(foreign).toMatchObject({ status: 401, json: { error: 'passkey_failed' } });
    expect(await h.auditActions()).toContain('login_failed');

    const bob = await acceptWithPasskey(h, await invite(h, owner, 'bob'));
    const bobId = Number((await bob.client.request('GET', '/api/admin/auth/me')).json.id);
    await owner.request('POST', `/api/admin/users/${bobId}/disable`);
    expect((await login(h, bob.authenticator)).json.error).toBe('passkey_failed');
  });

  it('erkennt zurückgesetzte Signaturzähler', async () => {
    const h = new Harness();
    const authenticator = new SoftwareAuthenticator(ORIGIN, 0x05, true);
    const boot = await h.client().request('POST', '/api/admin/auth/bootstrap', {
      token: 'bootstrap-secret-token',
      username: 'anna',
      displayName: 'Anna',
    });
    await acceptWithPasskey(h, tokenOf(boot.json.invitePath), authenticator);
    expect((await login(h, authenticator)).status).toBe(200);
    expect((await login(h, authenticator)).status).toBe(200);
    authenticator.credentials[0]!.signCount = 0;
    expect((await login(h, authenticator)).json.error).toBe('passkey_failed');
  });
});

describe('Passkey-Reauth und Kontoverwaltung', () => {
  it('bestätigt per Passkey und trennt Login- von Reauth-Challenges', async () => {
    const h = new Harness();
    const { client, authenticator } = await bootstrapWithPasskey(h);
    h.clock.advance(16 * 60_000);
    expect((await client.request('GET', '/api/admin/auth/me')).json.reauthValid).toBe(false);

    const loginOptions = await client.request('POST', '/api/admin/auth/passkey/options', {});
    const wrongPurpose = await client.request('POST', '/api/admin/auth/reauth/passkey', {
      credential: await authenticator.get(loginOptions.json as never),
    });
    expect(wrongPurpose.json.error).toBe('challenge_expired');

    expect((await reauth(client, authenticator)).status).toBe(200);
    expect((await client.request('GET', '/api/admin/auth/me')).json.reauthValid).toBe(true);
    expect(await h.auditActions()).toContain('reauth_passkey');
  });

  it('akzeptiert für Reauth nur eigene Passkeys', async () => {
    const h = new Harness();
    const { client: owner, authenticator } = await bootstrapWithPasskey(h);
    const bob = await acceptWithPasskey(h, await invite(h, owner, 'bob'));
    const options = await bob.client.request('POST', '/api/admin/auth/reauth/passkey/options', {});
    const credential = await authenticator.get({
      ...(options.json as { challenge: string; rpId: string }),
      allowCredentials: [],
    });
    const res = await bob.client.request('POST', '/api/admin/auth/reauth/passkey', { credential });
    expect(res).toMatchObject({ status: 401, json: { error: 'passkey_failed' } });
  });

  it('verwaltet Passkeys und schützt den letzten Zugang', async () => {
    const h = new Harness();
    const { client, authenticator } = await bootstrapWithPasskey(h);
    h.clock.advance(16 * 60_000);
    const blocked = await client.request('POST', '/api/admin/account/passkeys/options', {});
    expect(blocked.json.error).toBe('reauth_required');
    await reauth(client, authenticator);

    const second = new SoftwareAuthenticator(ORIGIN);
    const options = await client.request('POST', '/api/admin/account/passkeys/options', {});
    expect(options.json.excludeCredentials).toHaveLength(1);
    const added = await client.request('POST', '/api/admin/account/passkeys', {
      credential: await second.create(options.json as never),
    });
    expect(added.status).toBe(200);
    expect((await login(h, second)).status).toBe(200);

    const renamed = await client.request('PATCH', `/api/admin/account/passkeys/${Number(added.json.id)}`, {
      name: 'iPhone',
    });
    expect(renamed.status).toBe(200);
    const list = (await client.request('GET', '/api/admin/account/passkeys')).json.passkeys as PasskeyRow[];
    expect(list.map((p) => p.name)).toContain('iPhone');

    const ids = list.map((p) => p.id);
    const results = await Promise.all(ids.map((id) => client.request('DELETE', `/api/admin/account/passkeys/${id}`)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.json.error).toBe('last_credential');
    expect((await client.request('DELETE', '/api/admin/account/passkeys/9999')).status).toBe(404);
  });

  it('erlaubt Passwort-Konten einen Passkey zu ergänzen und wieder zu löschen', async () => {
    const h = new Harness();
    const boot = await h.client().request('POST', '/api/admin/auth/bootstrap', {
      token: 'bootstrap-secret-token',
      username: 'anna',
      displayName: 'Anna',
    });
    const token = tokenOf(boot.json.invitePath);
    const client = h.client();
    const setup = await client.request('POST', '/api/admin/auth/invite/setup', { token });
    const done = await client.request('POST', '/api/admin/auth/invite/complete', {
      token,
      password: PASSWORD,
      setupToken: setup.json.setupToken,
      code: await totpCode(String(setup.json.secret), Math.floor(h.clock.time / 30_000)),
    });
    expect(done.status).toBe(200);
    const noPasskey = await client.request('POST', '/api/admin/auth/reauth/passkey/options', {});
    expect(noPasskey.json.error).toBe('no_passkey');

    const authenticator = new SoftwareAuthenticator(ORIGIN);
    const options = await client.request('POST', '/api/admin/account/passkeys/options', {});
    await client.request('POST', '/api/admin/account/passkeys', {
      credential: await authenticator.create(options.json as never),
    });
    expect((await client.request('GET', '/api/admin/auth/me')).json).toMatchObject({
      hasPassword: true,
      hasTotp: true,
      passkeyCount: 1,
    });
    expect((await login(h, authenticator)).status).toBe(200);
    const [passkey] = (await client.request('GET', '/api/admin/account/passkeys')).json.passkeys as PasskeyRow[];
    expect((await client.request('DELETE', `/api/admin/account/passkeys/${passkey!.id}`)).status).toBe(200);
  });
});
