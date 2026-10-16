import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { body, clientIp, fail, idParam, query, type AppContext, type AppEnv } from '../http.ts';
import { decodeGuest, encodeGuest, GUEST_COOKIE, newDeviceId, type GuestIdentity } from '../security/guest.ts';
import { ipKeyHash } from '../security/ip.ts';
import { verifyPresenceToken } from '../security/presence.ts';
import { hitRateLimit } from '../security/ratelimit.ts';
import { readBudget, throttleFactor } from '../services/budget.ts';
import { openRound, votingActive } from '../services/rounds.ts';
import { loadSettings } from '../services/settings.ts';
import { legal } from '../../shared/legal.ts';
import type { Settings } from '../../shared/settings.ts';
import { castVote, ipVoteLimit, myVote } from '../services/votes.ts';
import { createWish, guestWishes, searchTracks, upvoteWish, WishError } from '../services/wishes.ts';
import { tick, readSnapshot } from '../services/tick.ts';
import { roundView, type RoundView } from '../views.ts';

export const publicRoutes = new Hono<AppEnv>();

const HOUR = 3_600_000;
const MIN_GUEST_POLL_MS = 3_000;
const MAX_GUEST_POLL_MS = 5 * 60_000;
const GUEST_POLL_JITTER_MS = 20_000;

async function limit(c: AppContext, name: string, max: number, windowSeconds: number, subject: string) {
  const result = await hitRateLimit(c.env.DB, `${name}:${subject}`, max, windowSeconds, c.var.rt.now());
  if (!result.allowed) fail(429, 'rate_limited', { retryAfterSeconds: result.retryAfterSeconds });
}

function clientNetwork(c: AppContext) {
  return ipKeyHash(c.env.IP_HASH_SECRET, clientIp(c));
}

async function requireGuest(c: AppContext): Promise<GuestIdentity> {
  const guest = await decodeGuest(c.env.COOKIE_SECRET, getCookie(c, GUEST_COOKIE), c.var.rt.now());
  if (!guest) fail(401, 'not_joined');
  return guest;
}

async function guestPollAfterMs(c: AppContext, settings: Settings, round: RoundView | null, now: number) {
  const until = (at: number) =>
    Math.round(
      Math.min(MAX_GUEST_POLL_MS, Math.max(at - now, MIN_GUEST_POLL_MS) + Math.random() * GUEST_POLL_JITTER_MS),
    );
  if (round) return until(round.expectedCloseAt);
  if (votingActive(settings, now)) return settings.polling.guestMs * throttleFactor(await readBudget(c.env.DB), now);
  if (settings.voting.enabled && now < settings.voting.startsAt) return until(settings.voting.startsAt);
  return MAX_GUEST_POLL_MS;
}

publicRoutes.post('/join', async (c) => {
  const now = c.var.rt.now();
  const ip = await clientNetwork(c);
  await limit(c, 'join', 300, 600, ip.hash);
  const input = await body(c, z.object({ token: z.string().max(16).optional() }));
  const existing = await decodeGuest(c.env.COOKIE_SECRET, getCookie(c, GUEST_COOKIE), now);
  if (!existing) {
    if (!input.token || !(await verifyPresenceToken(c.env.QR_SECRET, input.token, now))) fail(403, 'qr_expired');
    if (ip.netHash !== ip.hash) await limit(c, 'join-net', 300, 600, ip.netHash);
  }
  const settings = await loadSettings(c.env.DB, now);
  const fresh = Math.min(
    Math.max(settings.event.endsAt + 6 * HOUR, now + 12 * HOUR),
    now + legal.retention.cookieMaxHours * HOUR,
  );
  const identity: GuestIdentity = {
    deviceId: existing?.deviceId ?? newDeviceId(),
    expiresAt: existing ? Math.min(existing.expiresAt, fresh) : fresh,
  };
  await c.env.DB.prepare(
    `INSERT INTO devices (id, created_at, ip_key, last_seen_at) VALUES (?1, ?2, ?3, ?2)
     ON CONFLICT (id) DO UPDATE SET ip_key = excluded.ip_key, last_seen_at = excluded.last_seen_at`,
  )
    .bind(identity.deviceId, now, ip.hash)
    .run();
  setCookie(c, GUEST_COOKIE, await encodeGuest(c.env.COOKIE_SECRET, identity), {
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: Math.floor((identity.expiresAt - now) / 1000),
  });
  return c.json({ joined: true });
});

publicRoutes.get('/state', async (c) => {
  const rt = c.var.rt;
  const now = rt.now();
  const decoded = await decodeGuest(c.env.COOKIE_SECRET, getCookie(c, GUEST_COOKIE), now);
  const settings = await loadSettings(c.env.DB, now);
  if (!decoded) {
    return c.json({ joined: false, now, eventName: settings.event.name, pollAfterMs: MAX_GUEST_POLL_MS });
  }
  rt.waitUntil(tick(rt));
  const round = await openRound(c.env.DB);
  const snapshot = await readSnapshot(c.env.DB);
  const track = snapshot?.snapshot?.track;
  const view = round ? await roundView(c.env.DB, round, now, { includeTally: false, snapshot }) : null;
  return c.json({
    joined: true,
    now,
    eventName: settings.event.name,
    voting: { active: votingActive(settings, now), startsAt: settings.voting.startsAt, endsAt: settings.voting.endsAt },
    round: view,
    myVote: round ? await myVote(c.env.DB, round.id, decoded.deviceId) : null,
    nowPlaying: track ? { title: track.title, artist: track.artist, imageUrl: track.imageUrl } : null,
    pollAfterMs: await guestPollAfterMs(c, settings, view, now),
  });
});

publicRoutes.post('/vote', async (c) => {
  const now = c.var.rt.now();
  const guest = await requireGuest(c);
  const ip = await clientNetwork(c);
  await limit(c, 'vote-device', 10, 60, guest.deviceId);
  await limit(c, 'vote-ip', 60, 60, ip.hash);
  const input = await body(c, z.object({ roundId: z.number().int().positive(), songId: z.number().int().positive() }));
  const settings = await loadSettings(c.env.DB, now);
  const outcome = await castVote(c.env.DB, settings, {
    roundId: input.roundId,
    songId: input.songId,
    deviceId: guest.deviceId,
    ipKey: ip.hash,
    netKey: ip.netHash,
    ipFamily: ip.family,
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
  const ip = await clientNetwork(c);
  await limit(c, 'wish-device', 5, 600, guest.deviceId);
  await limit(c, 'wish-ip', 30, 600, ip.hash);
  const input = await body(c, z.object({ uri: z.string().regex(/^spotify:track:[A-Za-z0-9]{10,40}$/) }));
  const settings = await loadSettings(c.env.DB, now);
  try {
    return c.json(
      await createWish(c.env.DB, c.var.rt.spotify, guest.deviceId, input.uri, now, {
        ipKey: ip.hash,
        limit: ipVoteLimit(settings, ip.family),
      }),
    );
  } catch (error) {
    if (error instanceof WishError) fail(409, error.message);
    throw error;
  }
});

publicRoutes.post('/wishes/:id/upvote', async (c) => {
  const now = c.var.rt.now();
  const guest = await requireGuest(c);
  await limit(c, 'upvote-device', 30, 600, guest.deviceId);
  const ip = await clientNetwork(c);
  const settings = await loadSettings(c.env.DB, now);
  const ok = await upvoteWish(c.env.DB, idParam(c), guest.deviceId, now, {
    ipKey: ip.hash,
    limit: ipVoteLimit(settings, ip.family),
  });
  return c.json({ ok });
});
