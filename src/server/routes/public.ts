import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { body, clientIp, fail, idParam, query, type AppContext, type AppEnv } from '../http.ts';
import { sha256Hex } from '../security/crypto.ts';
import { decodeGuest, encodeGuest, GUEST_COOKIE, newDeviceId, type GuestIdentity } from '../security/guest.ts';
import { ipKeyHash } from '../security/ip.ts';
import { verifyPresenceToken } from '../security/presence.ts';
import { hitRateLimit } from '../security/ratelimit.ts';
import { verifyTurnstile } from '../security/turnstile.ts';
import { readBudget, throttleFactor } from '../services/budget.ts';
import { openRound, votingActive } from '../services/rounds.ts';
import { loadSettings } from '../services/settings.ts';
import { castVote, myVote } from '../services/votes.ts';
import { createWish, guestWishes, searchTracks, upvoteWish, WishError } from '../services/wishes.ts';
import { tick, readSnapshot } from '../services/tick.ts';
import { roundView } from '../views.ts';

export const publicRoutes = new Hono<AppEnv>();

async function limit(c: AppContext, name: string, max: number, windowSeconds: number, subject?: string) {
  const ip = (await ipKeyHash(c.env.IP_HASH_SECRET, clientIp(c))).hash;
  const result = await hitRateLimit(c.env.DB, `${name}:${subject ?? ip}`, max, windowSeconds, c.var.rt.now());
  if (!result.allowed) fail(429, 'rate_limited', { retryAfterSeconds: result.retryAfterSeconds });
}

async function requireGuest(c: AppContext): Promise<GuestIdentity> {
  const guest = await decodeGuest(c.env.COOKIE_SECRET, getCookie(c, GUEST_COOKIE), c.var.rt.now());
  if (!guest) fail(401, 'not_joined');
  return guest;
}

publicRoutes.get('/config', async (c) => {
  const settings = await loadSettings(c.env.DB, c.var.rt.now());
  return c.json({
    eventName: settings.event.name,
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY && c.env.TURNSTILE_SECRET ? c.env.TURNSTILE_SITE_KEY : null,
  });
});

publicRoutes.post('/join', async (c) => {
  const now = c.var.rt.now();
  await limit(c, 'join', 30, 600);
  const input = await body(
    c,
    z.object({
      token: z.string().max(16).optional(),
      turnstile: z.string().max(4096).optional(),
      fingerprint: z.string().max(512).optional(),
    }),
  );
  const existing = await decodeGuest(c.env.COOKIE_SECRET, getCookie(c, GUEST_COOKIE), now);
  if (!existing) {
    if (!input.token || !(await verifyPresenceToken(c.env.QR_SECRET, input.token, now))) fail(403, 'qr_expired');
  }
  const settings = await loadSettings(c.env.DB, now);
  const verified =
    existing?.verified === true || (await verifyTurnstile(c.env.TURNSTILE_SECRET, input.turnstile, clientIp(c)));
  const identity: GuestIdentity = {
    deviceId: existing?.deviceId ?? newDeviceId(),
    verified,
    expiresAt: Math.max(settings.event.endsAt + 6 * 3_600_000, now + 12 * 3_600_000),
  };
  const ip = await ipKeyHash(c.env.IP_HASH_SECRET, clientIp(c));
  const fpHash = input.fingerprint ? (await sha256Hex(`fp:${input.fingerprint}`)).slice(0, 24) : null;
  await c.env.DB.prepare(
    `INSERT INTO devices (id, created_at, verified, fp_hash, ip_key, last_seen_at) VALUES (?1, ?2, ?3, ?4, ?5, ?2)
     ON CONFLICT (id) DO UPDATE SET verified = MAX(verified, excluded.verified), fp_hash = COALESCE(excluded.fp_hash, fp_hash),
       ip_key = excluded.ip_key, last_seen_at = excluded.last_seen_at`,
  )
    .bind(identity.deviceId, now, verified ? 1 : 0, fpHash, ip.hash)
    .run();
  setCookie(c, GUEST_COOKIE, await encodeGuest(c.env.COOKIE_SECRET, identity), {
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: Math.floor((identity.expiresAt - now) / 1000),
  });
  return c.json({ joined: true, verified });
});

publicRoutes.get('/state', async (c) => {
  const rt = c.var.rt;
  const now = rt.now();
  const guest = await decodeGuest(c.env.COOKIE_SECRET, getCookie(c, GUEST_COOKIE), now);
  const settings = await loadSettings(c.env.DB, now);
  const pollAfterMs = settings.polling.guestMs * throttleFactor(await readBudget(c.env.DB), now);
  if (!guest) return c.json({ joined: false, now, eventName: settings.event.name, pollAfterMs });
  rt.waitUntil(tick(rt));
  const round = await openRound(c.env.DB);
  const snapshot = await readSnapshot(c.env.DB);
  const track = snapshot?.snapshot?.track;
  return c.json({
    joined: true,
    verified: guest.verified,
    now,
    eventName: settings.event.name,
    voting: { active: votingActive(settings, now), startsAt: settings.voting.startsAt, endsAt: settings.voting.endsAt },
    round: round ? await roundView(c.env.DB, round, now, { includeTally: false, snapshot }) : null,
    myVote: round ? await myVote(c.env.DB, round.id, guest.deviceId) : null,
    nowPlaying: track ? { title: track.title, artist: track.artist, imageUrl: track.imageUrl } : null,
    pollAfterMs,
  });
});

publicRoutes.post('/vote', async (c) => {
  const now = c.var.rt.now();
  const guest = await requireGuest(c);
  await limit(c, 'vote-device', 10, 60, guest.deviceId);
  await limit(c, 'vote-ip', 60, 60);
  const input = await body(c, z.object({ roundId: z.number().int().positive(), songId: z.number().int().positive() }));
  const settings = await loadSettings(c.env.DB, now);
  const ip = await ipKeyHash(c.env.IP_HASH_SECRET, clientIp(c));
  const device = await c.env.DB.prepare('SELECT fp_hash FROM devices WHERE id = ?1')
    .bind(guest.deviceId)
    .first<{ fp_hash: string | null }>();
  const outcome = await castVote(c.env.DB, settings, {
    roundId: input.roundId,
    songId: input.songId,
    deviceId: guest.deviceId,
    ipKey: ip.hash,
    ipFamily: ip.family,
    verified: guest.verified,
    fpHash: device?.fp_hash ?? null,
    now,
  });
  if (outcome === 'ok') return c.json({ ok: true, songId: input.songId });
  if (outcome === 'ip_limit') {
    await hitRateLimit(c.env.DB, 'stat:ip_limit_rejections', 1_000_000, 86_400, now);
    fail(409, 'ip_limit');
  }
  fail(409, outcome);
});

publicRoutes.get('/search', async (c) => {
  const now = c.var.rt.now();
  const guest = await requireGuest(c);
  await limit(c, 'search-device', 20, 60, guest.deviceId);
  const { q } = query(c, z.object({ q: z.string().min(1).max(100) }));
  const result = await searchTracks(c.env.DB, c.var.rt.spotify, q, now);
  return c.json({
    limited: result.limited,
    tracks: result.tracks.map((t) => ({
      uri: t.uri,
      title: t.title,
      artist: t.artist,
      imageUrl: t.imageUrl,
      explicit: t.explicit,
      durationMs: t.durationMs,
    })),
  });
});

publicRoutes.get('/wishes', async (c) => {
  const guest = await requireGuest(c);
  return c.json({ wishes: await guestWishes(c.env.DB, guest.deviceId) });
});

publicRoutes.post('/wishes', async (c) => {
  const now = c.var.rt.now();
  const guest = await requireGuest(c);
  await limit(c, 'wish-device', 5, 600, guest.deviceId);
  const input = await body(c, z.object({ uri: z.string().regex(/^spotify:track:[A-Za-z0-9]{10,40}$/) }));
  try {
    return c.json(await createWish(c.env.DB, c.var.rt.spotify, guest.deviceId, input.uri, now));
  } catch (error) {
    if (error instanceof WishError) fail(409, error.message);
    throw error;
  }
});

publicRoutes.post('/wishes/:id/upvote', async (c) => {
  const now = c.var.rt.now();
  const guest = await requireGuest(c);
  await limit(c, 'upvote-device', 30, 600, guest.deviceId);
  return c.json({ ok: await upvoteWish(c.env.DB, idParam(c), guest.deviceId, now) });
});
