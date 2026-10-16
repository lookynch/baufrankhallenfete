import { Hono } from 'hono';
import { z } from 'zod';
import { body, clientIp, clientIpHash, fail, idParam, type AppContext, type AppEnv } from '../../http.ts';
import { randomToken } from '../../security/crypto.ts';
import { ipKeyHash } from '../../security/ip.ts';
import { markReauth } from '../../security/session.ts';
import {
  authenticationCredentialSchema,
  authenticationOptions,
  consumeChallenge,
  issueChallenge,
  parseClientData,
  registrationCredentialSchema,
  registrationOptions,
  relyingParty,
  verifyAuthentication,
  verifyRegistration,
  type AuthenticationCredential,
  type ChallengePurpose,
  type CredentialDescriptor,
  type RegistrationCredential,
  type RelyingParty,
} from '../../security/webauthn.ts';
import { audit, auditStatement } from '../../services/audit.ts';
import {
  assertInviteApplicable,
  finishInvite,
  inviteTarget,
  ISSUER,
  issueSession,
  loadInvite,
  rateLimit,
  requireAdmin,
  requireReauth,
} from './auth.ts';

const inviteToken = z.string().min(20).max(100);

function relyingPartyOf(c: AppContext): RelyingParty {
  return relyingParty(c.env.WEBAUTHN_ORIGIN, ISSUER) ?? fail(503, 'passkeys_unavailable');
}

function passkeyName(now: number): string {
  return `Passkey vom ${new Date(now).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}`;
}

async function ensureWebauthnUserId(db: D1Database, userId: number): Promise<string> {
  await db
    .prepare('UPDATE admin_users SET webauthn_user_id = ?2 WHERE id = ?1 AND webauthn_user_id IS NULL')
    .bind(userId, randomToken(16))
    .run();
  const row = await db
    .prepare('SELECT webauthn_user_id FROM admin_users WHERE id = ?1')
    .bind(userId)
    .first<{ webauthn_user_id: string }>();
  if (!row) fail(401, 'not_authenticated');
  return row.webauthn_user_id;
}

async function credentialsOf(db: D1Database, userId: number): Promise<CredentialDescriptor[]> {
  const { results } = await db
    .prepare('SELECT credential_id, transports FROM admin_passkeys WHERE user_id = ?1')
    .bind(userId)
    .all<{ credential_id: string; transports: string | null }>();
  return results.map((r) => ({
    credentialId: r.credential_id,
    transports: JSON.parse(r.transports ?? '[]') as string[],
  }));
}

async function claimChallenge(
  c: AppContext,
  credential: RegistrationCredential | AuthenticationCredential,
  purpose: ChallengePurpose,
  subject: string | null,
) {
  const clientData = parseClientData(credential.response.clientDataJSON) ?? fail(422, 'passkey_failed');
  const challenge =
    (await consumeChallenge(c.env.DB, clientData.challenge, purpose, subject, c.var.rt.now())) ??
    fail(422, 'challenge_expired');
  return { clientData, webauthnUserId: challenge.webauthn_user_id };
}

async function registerCredential(
  c: AppContext,
  credential: RegistrationCredential,
  purpose: ChallengePurpose,
  subject: string,
) {
  const rp = relyingPartyOf(c);
  const { clientData, webauthnUserId } = await claimChallenge(c, credential, purpose, subject);
  const passkey = (await verifyRegistration(rp, credential, clientData)) ?? fail(422, 'passkey_failed');
  const existing = await c.env.DB.prepare('SELECT 1 FROM admin_passkeys WHERE credential_id = ?1')
    .bind(passkey.credentialId)
    .first();
  if (existing) fail(409, 'passkey_exists');
  return { passkey: { ...passkey, name: passkeyName(c.var.rt.now()) }, webauthnUserId };
}

interface StoredPasskey {
  id: number;
  user_id: number;
  public_key: string;
  sign_count: number;
  webauthn_user_id: string | null;
}

async function authenticate(
  c: AppContext,
  credential: AuthenticationCredential,
  purpose: ChallengePurpose,
  subject: string | null,
  userId: number | null,
): Promise<{ passkey: StoredPasskey; statement: D1PreparedStatement }> {
  const rp = relyingPartyOf(c);
  const { clientData } = await claimChallenge(c, credential, purpose, subject);
  const passkey = await c.env.DB.prepare(
    `SELECT p.id, p.user_id, p.public_key, p.sign_count, u.webauthn_user_id
     FROM admin_passkeys p JOIN admin_users u ON u.id = p.user_id
     WHERE p.credential_id = ?1 AND u.disabled = 0 AND (?2 IS NULL OR p.user_id = ?2)`,
  )
    .bind(credential.id, userId)
    .first<StoredPasskey>();
  if (!passkey) fail(401, 'passkey_failed');
  const handle = credential.response.userHandle;
  if (handle !== undefined && handle !== null && handle !== passkey.webauthn_user_id) fail(401, 'passkey_failed');
  const verified = await verifyAuthentication(rp, credential, clientData, {
    publicKey: passkey.public_key,
    signCount: passkey.sign_count,
  });
  if (!verified) {
    await audit(c.env.DB, c.var.rt.now(), {
      userId: passkey.user_id,
      action: purpose === 'login' ? 'login_failed' : 'reauth_failed',
      entity: 'admin_user',
      entityId: passkey.user_id,
      ipHash: await clientIpHash(c),
    });
    fail(401, 'passkey_failed');
  }
  const statement = c.env.DB.prepare('UPDATE admin_passkeys SET sign_count = ?2, last_used_at = ?3 WHERE id = ?1').bind(
    passkey.id,
    verified.signCount,
    c.var.rt.now(),
  );
  return { passkey, statement };
}

export const passkeyAuthRoutes = new Hono<AppEnv>();

passkeyAuthRoutes.post('/invite/passkey/options', async (c) => {
  await rateLimit(c, `invite:${await clientIpHash(c)}`, 30, 600);
  const rp = relyingPartyOf(c);
  const now = c.var.rt.now();
  const { token } = await body(c, z.object({ token: inviteToken }));
  const invite = await loadInvite(c.env.DB, token, now);
  const target = await inviteTarget(c.env.DB, invite.username);
  assertInviteApplicable(target, invite.role);
  const webauthnUserId = target ? await ensureWebauthnUserId(c.env.DB, target.id) : randomToken(16);
  const challenge = await issueChallenge(c.env.DB, 'register_invite', invite.token_hash, webauthnUserId, now);
  return c.json(
    registrationOptions(
      rp,
      challenge,
      { webauthnUserId, username: invite.username, displayName: invite.display_name },
      [],
    ),
  );
});

passkeyAuthRoutes.post('/invite/passkey/complete', async (c) => {
  await rateLimit(c, `invite:${await clientIpHash(c)}`, 30, 600);
  const input = await body(c, z.object({ token: inviteToken, credential: registrationCredentialSchema }));
  const invite = await loadInvite(c.env.DB, input.token, c.var.rt.now());
  const { passkey, webauthnUserId } = await registerCredential(
    c,
    input.credential,
    'register_invite',
    invite.token_hash,
  );
  assertInviteApplicable(await inviteTarget(c.env.DB, invite.username), invite.role);
  await finishInvite(c, invite, {
    passwordHash: '',
    totpSecretEnc: '',
    totpStep: 0,
    webauthnUserId,
    recoveryCodeHashes: [],
    passkey,
  });
  return c.json({ ok: true });
});

passkeyAuthRoutes.post('/passkey/options', async (c) => {
  const ip = await ipKeyHash(c.env.IP_HASH_SECRET, clientIp(c));
  await rateLimit(c, `passkey-ip:${ip.hash}`, 30, 900);
  if (ip.netHash !== ip.hash) await rateLimit(c, `passkey-net:${ip.netHash}`, 60, 900);
  const rp = relyingPartyOf(c);
  const challenge = await issueChallenge(c.env.DB, 'login', null, null, c.var.rt.now());
  return c.json(authenticationOptions(rp, challenge, []));
});

passkeyAuthRoutes.post('/passkey/verify', async (c) => {
  const now = c.var.rt.now();
  await rateLimit(c, `passkey-verify:${await clientIpHash(c)}`, 30, 900);
  const { credential } = await body(c, z.object({ credential: authenticationCredentialSchema }));
  const { passkey, statement } = await authenticate(c, credential, 'login', null, null);
  const db = c.env.DB;
  await db.batch([
    statement,
    db.prepare('UPDATE admin_users SET last_login_at = ?2 WHERE id = ?1').bind(passkey.user_id, now),
    auditStatement(db, now, {
      userId: passkey.user_id,
      action: 'login_passkey',
      entity: 'admin_user',
      entityId: passkey.user_id,
      ipHash: await clientIpHash(c),
    }),
  ]);
  await issueSession(c, passkey.user_id);
  return c.json({ ok: true });
});

passkeyAuthRoutes.post('/reauth/passkey/options', requireAdmin, async (c) => {
  const { userId, sessionHash } = c.var.admin;
  await rateLimit(c, `passkey-reauth:${userId}`, 20, 900);
  const rp = relyingPartyOf(c);
  const allow = await credentialsOf(c.env.DB, userId);
  if (!allow.length) fail(409, 'no_passkey');
  const challenge = await issueChallenge(c.env.DB, 'reauth', sessionHash, null, c.var.rt.now());
  return c.json(authenticationOptions(rp, challenge, allow));
});

passkeyAuthRoutes.post('/reauth/passkey', requireAdmin, async (c) => {
  const now = c.var.rt.now();
  const { userId, sessionHash } = c.var.admin;
  await rateLimit(c, `passkey-reauth:${userId}`, 20, 900);
  const { credential } = await body(c, z.object({ credential: authenticationCredentialSchema }));
  const { statement } = await authenticate(c, credential, 'reauth', sessionHash, userId);
  const db = c.env.DB;
  await db.batch([
    statement,
    markReauth(db, sessionHash, now),
    auditStatement(db, now, {
      userId,
      action: 'reauth_passkey',
      entity: 'admin_user',
      entityId: userId,
      ipHash: await clientIpHash(c),
    }),
  ]);
  return c.json({ ok: true });
});

export const accountRoutes = new Hono<AppEnv>();

accountRoutes.get('/account/passkeys', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, created_at, last_used_at FROM admin_passkeys WHERE user_id = ?1 ORDER BY created_at`,
  )
    .bind(c.var.admin.userId)
    .all();
  return c.json({ passkeys: results });
});

accountRoutes.post('/account/passkeys/options', async (c) => {
  requireReauth(c);
  const rp = relyingPartyOf(c);
  const admin = c.var.admin;
  const webauthnUserId = await ensureWebauthnUserId(c.env.DB, admin.userId);
  const challenge = await issueChallenge(
    c.env.DB,
    'register_account',
    String(admin.userId),
    webauthnUserId,
    c.var.rt.now(),
  );
  return c.json(
    registrationOptions(
      rp,
      challenge,
      { webauthnUserId, username: admin.username, displayName: admin.displayName },
      await credentialsOf(c.env.DB, admin.userId),
    ),
  );
});

accountRoutes.post('/account/passkeys', async (c) => {
  requireReauth(c);
  const now = c.var.rt.now();
  const { userId } = c.var.admin;
  const { credential } = await body(c, z.object({ credential: registrationCredentialSchema }));
  const { passkey } = await registerCredential(c, credential, 'register_account', String(userId));
  const db = c.env.DB;
  const [inserted] = await db.batch([
    db
      .prepare(
        `INSERT INTO admin_passkeys (credential_id, user_id, public_key, sign_count, transports, name, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(
        passkey.credentialId,
        userId,
        passkey.publicKey,
        passkey.signCount,
        JSON.stringify(passkey.transports),
        passkey.name,
        now,
      ),
    auditStatement(db, now, { userId, action: 'passkey_add', entity: 'admin_user', entityId: userId }),
  ]);
  return c.json({ id: inserted?.meta.last_row_id });
});

accountRoutes.patch('/account/passkeys/:id', async (c) => {
  const id = idParam(c);
  const { name } = await body(c, z.object({ name: z.string().trim().min(1).max(60) }));
  const result = await c.env.DB.prepare('UPDATE admin_passkeys SET name = ?3 WHERE id = ?1 AND user_id = ?2')
    .bind(id, c.var.admin.userId, name)
    .run();
  if (result.meta.changes !== 1) fail(404, 'not_found');
  return c.json({ ok: true });
});

accountRoutes.delete('/account/passkeys/:id', async (c) => {
  requireReauth(c);
  const now = c.var.rt.now();
  const id = idParam(c);
  const { userId } = c.var.admin;
  const db = c.env.DB;
  const deleted = await db
    .prepare(
      `DELETE FROM admin_passkeys WHERE id = ?1 AND user_id = ?2
         AND ((SELECT password_hash FROM admin_users WHERE id = ?2) <> ''
           OR (SELECT COUNT(*) FROM admin_passkeys WHERE user_id = ?2) > 1)`,
    )
    .bind(id, userId)
    .run();
  if (deleted.meta.changes === 1) {
    await audit(db, now, { userId, action: 'passkey_delete', entity: 'admin_user', entityId: userId });
    return c.json({ ok: true });
  }
  const exists = await db
    .prepare('SELECT 1 FROM admin_passkeys WHERE id = ?1 AND user_id = ?2')
    .bind(id, userId)
    .first();
  fail(exists ? 409 : 404, exists ? 'last_credential' : 'not_found');
});
