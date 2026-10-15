import { Hono, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { body, clientIp, clientIpHash, fail, sameOrigin, type AppContext, type AppEnv } from '../../http.ts';
import {
  decrypt,
  encrypt,
  hmacHex,
  randomBytes,
  randomToken,
  sha256Hex,
  signValue,
  timingSafeEqual,
  verifySignedValue,
} from '../../security/crypto.ts';
import {
  dummyPasswordWork,
  hashPassword,
  iterationsFrom,
  passwordProblem,
  verifyPassword,
} from '../../security/password.ts';
import { hitRateLimit } from '../../security/ratelimit.ts';
import {
  ADMIN_COOKIE,
  createSession,
  destroySession,
  hasRecentReauth,
  loadSession,
  markReauth,
  SESSION_ABSOLUTE_MS,
} from '../../security/session.ts';
import { base32Encode, generateTotpSecret, otpauthUri, verifyTotp } from '../../security/totp.ts';
import { verifyTurnstile } from '../../security/turnstile.ts';
import { verifyAccessJwt } from '../../security/access.ts';
import { audit, auditStatement } from '../../services/audit.ts';

export const INVITE_TTL_MS = 24 * 3_600_000;
const LOGIN_TICKET_MS = 5 * 60_000;
const ISSUER = 'Baufrankhallen-Fete';

export const authRoutes = new Hono<AppEnv>();

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: 'owner' | 'admin';
  password_hash: string;
  totp_secret_enc: string;
  totp_last_step: number;
  disabled: number;
}

export const adminGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  if (method !== 'GET' && method !== 'HEAD') {
    if (!sameOrigin(c) || c.req.header('X-Requested-With') !== 'fete') fail(403, 'csrf_check_failed');
  }
  if (c.env.ACCESS_AUD && c.env.ACCESS_TEAM_DOMAIN) {
    const valid = await verifyAccessJwt(
      c.req.header('Cf-Access-Jwt-Assertion'),
      c.env.ACCESS_TEAM_DOMAIN,
      c.env.ACCESS_AUD,
      c.var.rt.now(),
    );
    if (!valid) fail(403, 'access_required');
  }
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const principal = await loadSession(c.env.DB, getCookie(c, ADMIN_COOKIE), c.var.rt.now());
  if (!principal) fail(401, 'not_authenticated');
  c.set('admin', principal);
  await next();
};

export const requireOwner: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.var.admin.role !== 'owner') fail(403, 'owner_required');
  await next();
};

export function requireReauth(c: AppContext): void {
  if (!hasRecentReauth(c.var.admin, c.var.rt.now())) fail(403, 'reauth_required');
}

async function rateLimit(c: AppContext, key: string, max: number, windowSeconds: number): Promise<void> {
  const result = await hitRateLimit(c.env.DB, key, max, windowSeconds, c.var.rt.now());
  if (!result.allowed) fail(429, 'rate_limited', { retryAfterSeconds: result.retryAfterSeconds });
}

export async function createInvite(
  db: D1Database,
  input: { username: string; displayName: string; role: 'owner' | 'admin' },
  createdBy: number | null,
  now: number,
): Promise<string> {
  const token = randomToken(32);
  await db
    .prepare(
      `INSERT INTO admin_invites (token_hash, username, display_name, role, created_by, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(await sha256Hex(token), input.username, input.displayName, input.role, createdBy, now, now + INVITE_TTL_MS)
    .run();
  return token;
}

async function loadInvite(db: D1Database, token: string, now: number) {
  return db
    .prepare(
      'SELECT token_hash, username, display_name, role, expires_at FROM admin_invites WHERE token_hash = ?1 AND used_at IS NULL AND expires_at > ?2',
    )
    .bind(await sha256Hex(token), now)
    .first<{
      token_hash: string;
      username: string;
      display_name: string;
      role: 'owner' | 'admin';
      expires_at: number;
    }>();
}

async function recoveryHash(pepper: string, code: string): Promise<string> {
  return hmacHex(pepper, `recovery:${code.replace(/[^A-Z2-7]/gi, '').toUpperCase()}`);
}

function newRecoveryCode(): string {
  const raw = base32Encode(randomBytes(8)).slice(0, 12);
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

async function issueSession(c: AppContext, userId: number): Promise<void> {
  const now = c.var.rt.now();
  const token = await createSession(c.env.DB, userId, now, {
    ipHash: await clientIpHash(c),
    userAgent: c.req.header('User-Agent') ?? '',
  });
  setCookie(c, ADMIN_COOKIE, token, {
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Strict',
    maxAge: Math.floor(SESSION_ABSOLUTE_MS / 1000),
  });
}

const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(/^[a-zA-Z0-9._-]+$/);

authRoutes.post('/bootstrap', async (c) => {
  const now = c.var.rt.now();
  if (!c.env.BOOTSTRAP_TOKEN) fail(404, 'bootstrap_disabled');
  await rateLimit(c, `bootstrap:${await clientIpHash(c)}`, 5, 3600);
  const input = await body(
    c,
    z.object({ token: z.string().max(200), username: usernameSchema, displayName: z.string().trim().min(1).max(60) }),
  );
  if (!timingSafeEqual(input.token, c.env.BOOTSTRAP_TOKEN)) fail(403, 'invalid_bootstrap_token');
  const owners = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM admin_users WHERE role = 'owner' AND disabled = 0",
  ).first<{
    n: number;
  }>();
  if ((owners?.n ?? 0) > 0) fail(409, 'already_bootstrapped');
  const token = await createInvite(c.env.DB, { ...input, role: 'owner' }, null, now);
  await audit(c.env.DB, now, {
    userId: null,
    action: 'bootstrap_invite',
    entity: 'admin_invite',
    after: { username: input.username },
  });
  return c.json({ invitePath: `/admin/invite#${token}` });
});

authRoutes.post('/invite/info', async (c) => {
  await rateLimit(c, `invite:${await clientIpHash(c)}`, 30, 600);
  const { token } = await body(c, z.object({ token: z.string().min(20).max(100) }));
  const invite = await loadInvite(c.env.DB, token, c.var.rt.now());
  if (!invite) fail(404, 'invite_invalid');
  return c.json({
    username: invite.username,
    displayName: invite.display_name,
    role: invite.role,
    expiresAt: invite.expires_at,
  });
});

authRoutes.post('/invite/setup', async (c) => {
  await rateLimit(c, `invite:${await clientIpHash(c)}`, 30, 600);
  const now = c.var.rt.now();
  const { token } = await body(c, z.object({ token: z.string().min(20).max(100) }));
  const invite = await loadInvite(c.env.DB, token, now);
  if (!invite) fail(404, 'invite_invalid');
  const secret = generateTotpSecret();
  const setupToken = await signValue(c.env.COOKIE_SECRET, 'totp-setup', {
    s: await encrypt(c.env.ENC_KEY, secret),
    i: invite.token_hash,
    e: now + 15 * 60_000,
  });
  return c.json({ secret, otpauth: otpauthUri(secret, invite.username, ISSUER), setupToken });
});

authRoutes.post('/invite/complete', async (c) => {
  await rateLimit(c, `invite:${await clientIpHash(c)}`, 30, 600);
  const now = c.var.rt.now();
  const input = await body(
    c,
    z.object({
      token: z.string().min(20).max(100),
      password: z.string().max(256),
      setupToken: z.string().max(1000),
      code: z.string().regex(/^\d{6}$/),
    }),
  );
  const invite = await loadInvite(c.env.DB, input.token, now);
  if (!invite) fail(404, 'invite_invalid');
  const problem = passwordProblem(input.password, invite.username);
  if (problem) fail(422, problem);
  const setup = await verifySignedValue<{ s: string; i: string; e: number }>(
    c.env.COOKIE_SECRET,
    'totp-setup',
    input.setupToken,
  );
  if (!setup || setup.i !== invite.token_hash || setup.e < now) fail(422, 'setup_expired');
  const secret = await decrypt(c.env.ENC_KEY, setup.s);
  const step = await verifyTotp(secret, input.code, now, 0);
  if (step === null) fail(422, 'invalid_code');

  const passwordHash = await hashPassword(
    input.password,
    c.env.SESSION_PEPPER,
    iterationsFrom(c.env.PBKDF2_ITERATIONS),
  );
  const secretEnc = await encrypt(c.env.ENC_KEY, secret);
  const db = c.env.DB;
  const claimed = await db
    .prepare('UPDATE admin_invites SET used_at = ?2 WHERE token_hash = ?1 AND used_at IS NULL')
    .bind(invite.token_hash, now)
    .run();
  if (claimed.meta.changes !== 1) fail(409, 'invite_used');
  const user = await db
    .prepare(
      `INSERT INTO admin_users (username, display_name, role, password_hash, totp_secret_enc, totp_last_step, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (username) DO UPDATE SET display_name = excluded.display_name, role = excluded.role,
         password_hash = excluded.password_hash, totp_secret_enc = excluded.totp_secret_enc,
         totp_last_step = excluded.totp_last_step, disabled = 0
       RETURNING id`,
    )
    .bind(invite.username, invite.display_name, invite.role, passwordHash, secretEnc, step, now)
    .first<{ id: number }>();
  if (!user) fail(500, 'user_not_created');
  const codes = Array.from({ length: 10 }, newRecoveryCode);
  const hashes = await Promise.all(codes.map((code) => recoveryHash(c.env.SESSION_PEPPER, code)));
  await db.batch([
    db.prepare('DELETE FROM admin_sessions WHERE user_id = ?1').bind(user.id),
    db.prepare('DELETE FROM admin_recovery_codes WHERE user_id = ?1').bind(user.id),
    ...hashes.map((h) =>
      db.prepare('INSERT INTO admin_recovery_codes (user_id, code_hash) VALUES (?1, ?2)').bind(user.id, h),
    ),
    auditStatement(db, now, { userId: user.id, action: 'invite_completed', entity: 'admin_user', entityId: user.id }),
  ]);
  await issueSession(c, user.id);
  return c.json({ recoveryCodes: codes });
});

authRoutes.post('/login', async (c) => {
  const now = c.var.rt.now();
  const ipHash = await clientIpHash(c);
  await rateLimit(c, `login-ip:${ipHash}`, 30, 900);
  const input = await body(
    c,
    z.object({
      username: z.string().trim().max(40),
      password: z.string().max(256),
      turnstile: z.string().max(4096).optional(),
    }),
  );
  await rateLimit(c, `login:${input.username.toLowerCase()}:${ipHash}`, 5, 900);
  if (c.env.TURNSTILE_SECRET && !(await verifyTurnstile(c.env.TURNSTILE_SECRET, input.turnstile, clientIp(c)))) {
    fail(403, 'turnstile_failed');
  }
  const iterations = iterationsFrom(c.env.PBKDF2_ITERATIONS);
  const user = await c.env.DB.prepare('SELECT * FROM admin_users WHERE username = ?1 AND disabled = 0')
    .bind(input.username)
    .first<UserRow>();
  if (!user) {
    await dummyPasswordWork(c.env.SESSION_PEPPER, iterations);
    fail(401, 'invalid_credentials');
  }
  const verified = await verifyPassword(input.password, user.password_hash, c.env.SESSION_PEPPER);
  if (!verified.ok) {
    await audit(c.env.DB, now, {
      userId: user.id,
      action: 'login_failed',
      entity: 'admin_user',
      entityId: user.id,
      ipHash,
    });
    fail(401, 'invalid_credentials');
  }
  if (verified.iterations !== iterations) {
    const rehashed = await hashPassword(input.password, c.env.SESSION_PEPPER, iterations);
    await c.env.DB.prepare('UPDATE admin_users SET password_hash = ?2 WHERE id = ?1').bind(user.id, rehashed).run();
  }
  const ticket = await signValue(c.env.COOKIE_SECRET, 'login-ticket', {
    u: user.id,
    e: now + LOGIN_TICKET_MS,
    n: randomToken(8),
  });
  return c.json({ ticket });
});

async function verifySecondFactor(
  c: AppContext,
  user: UserRow,
  code: string | undefined,
  recovery: string | undefined,
) {
  const now = c.var.rt.now();
  const db = c.env.DB;
  if (code) {
    const secret = await decrypt(c.env.ENC_KEY, user.totp_secret_enc);
    const step = await verifyTotp(secret, code, now, user.totp_last_step);
    if (step === null) return false;
    const updated = await db
      .prepare('UPDATE admin_users SET totp_last_step = ?2 WHERE id = ?1 AND totp_last_step < ?2')
      .bind(user.id, step)
      .run();
    return updated.meta.changes === 1;
  }
  if (recovery) {
    const hash = await recoveryHash(c.env.SESSION_PEPPER, recovery);
    const used = await db
      .prepare('UPDATE admin_recovery_codes SET used_at = ?3 WHERE user_id = ?1 AND code_hash = ?2 AND used_at IS NULL')
      .bind(user.id, hash, now)
      .run();
    return used.meta.changes === 1;
  }
  return false;
}

authRoutes.post('/verify', async (c) => {
  const now = c.var.rt.now();
  const input = await body(
    c,
    z.object({
      ticket: z.string().max(1000),
      code: z
        .string()
        .regex(/^\d{6}$/)
        .optional(),
      recoveryCode: z.string().max(20).optional(),
    }),
  );
  const ticket = await verifySignedValue<{ u: number; e: number }>(c.env.COOKIE_SECRET, 'login-ticket', input.ticket);
  if (!ticket || ticket.e < now) fail(401, 'login_expired');
  await rateLimit(c, `totp:${ticket.u}`, 6, 900);
  const user = await c.env.DB.prepare('SELECT * FROM admin_users WHERE id = ?1 AND disabled = 0')
    .bind(ticket.u)
    .first<UserRow>();
  if (!user) fail(401, 'login_expired');
  if (!(await verifySecondFactor(c, user, input.code, input.recoveryCode))) {
    await audit(c.env.DB, now, {
      userId: user.id,
      action: 'second_factor_failed',
      entity: 'admin_user',
      entityId: user.id,
    });
    fail(401, 'invalid_code');
  }
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE admin_users SET last_login_at = ?2 WHERE id = ?1').bind(user.id, now),
    auditStatement(c.env.DB, now, {
      userId: user.id,
      action: input.recoveryCode ? 'login_recovery_code' : 'login',
      entity: 'admin_user',
      entityId: user.id,
      ipHash: await clientIpHash(c),
    }),
  ]);
  await issueSession(c, user.id);
  return c.json({ ok: true });
});

authRoutes.post('/logout', requireAdmin, async (c) => {
  await destroySession(c.env.DB, c.var.admin.sessionHash);
  deleteCookie(c, ADMIN_COOKIE, { path: '/', secure: true });
  return c.json({ ok: true });
});

authRoutes.get('/me', requireAdmin, async (c) => {
  const admin = c.var.admin;
  const recovery = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM admin_recovery_codes WHERE user_id = ?1 AND used_at IS NULL',
  )
    .bind(admin.userId)
    .first<{ n: number }>();
  return c.json({
    id: admin.userId,
    username: admin.username,
    displayName: admin.displayName,
    role: admin.role,
    reauthValid: hasRecentReauth(admin, c.var.rt.now()),
    recoveryCodesLeft: recovery?.n ?? 0,
  });
});

authRoutes.post('/reauth', requireAdmin, async (c) => {
  const now = c.var.rt.now();
  await rateLimit(c, `totp:${c.var.admin.userId}`, 6, 900);
  const { code } = await body(c, z.object({ code: z.string().regex(/^\d{6}$/) }));
  const user = await c.env.DB.prepare('SELECT * FROM admin_users WHERE id = ?1')
    .bind(c.var.admin.userId)
    .first<UserRow>();
  if (!user || !(await verifySecondFactor(c, user, code, undefined))) fail(401, 'invalid_code');
  await markReauth(c.env.DB, c.var.admin.sessionHash, now);
  return c.json({ ok: true });
});
