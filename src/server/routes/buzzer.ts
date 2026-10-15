import { Hono } from 'hono';
import { z } from 'zod';
import { clientIpHash, fail, type AppContext, type AppEnv } from '../http.ts';
import { hmacHex, sha256Hex, timingSafeEqual } from '../security/crypto.ts';
import { hitRateLimit } from '../security/ratelimit.ts';
import { setKv } from '../services/kv.ts';
import { bookBuzzerPress } from '../services/ledger.ts';
import { loadSettings } from '../services/settings.ts';
import { tick, upcomingTick } from '../services/tick.ts';

export const buzzerRoutes = new Hono<AppEnv>();

const MAX_SKEW_MS = 60_000;

export async function buzzerSignature(secret: string, method: string, path: string, timestamp: string, raw: string) {
  return hmacHex(secret, `${method}\n${path}\n${timestamp}\n${await sha256Hex(raw)}`);
}

async function verifiedBody(c: AppContext): Promise<{ agentId: string; json: unknown }> {
  const now = c.var.rt.now();
  const failures = `buzzer-fail:${await clientIpHash(c)}`;
  const raw = await c.req.text();
  if (raw.length > 2_048) fail(413, 'payload_too_large');
  const timestamp = c.req.header('X-Fete-Timestamp') ?? '';
  const signature = c.req.header('X-Fete-Signature') ?? '';
  const agentId = c.req.header('X-Fete-Agent') ?? '';
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(agentId)) fail(422, 'invalid_agent');
  const expected = await buzzerSignature(
    c.env.BUZZER_HMAC_SECRET,
    c.req.method,
    new URL(c.req.url).pathname,
    timestamp,
    raw,
  );
  if (!timingSafeEqual(signature.toLowerCase(), expected)) {
    const limited = await hitRateLimit(c.env.DB, failures, 20, 600, now);
    fail(limited.allowed ? 401 : 429, 'bad_signature', { server_time: now });
  }
  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > MAX_SKEW_MS)
    fail(401, 'stale_timestamp', { server_time: now });
  try {
    return { agentId, json: JSON.parse(raw) };
  } catch {
    fail(422, 'invalid_json');
  }
}

const pressSchema = z.object({
  event_id: z.string().uuid(),
  pressed_at: z.number().int(),
  source_code: z.string().max(40).nullable().optional(),
  agent_id: z.string().max(40).optional(),
});

buzzerRoutes.post('/press', async (c) => {
  const rt = c.var.rt;
  const now = rt.now();
  const { agentId, json } = await verifiedBody(c);
  const parsed = pressSchema.safeParse(json);
  if (!parsed.success) fail(422, 'invalid_payload');
  const settings = await loadSettings(c.env.DB, now);
  const press = parsed.data;
  if (press.pressed_at > now + MAX_SKEW_MS) fail(422, 'pressed_in_future');
  if (press.pressed_at < settings.event.startsAt - 2 * 3_600_000) fail(422, 'outside_event');
  const result = await bookBuzzerPress(c.env.DB, settings, {
    eventId: press.event_id,
    agentId,
    sourceCode: press.source_code ?? null,
    pressedAt: press.pressed_at,
    receivedAt: now,
  });
  return c.json({ status: result.status, booking_no: result.bookingNo, flagged: result.flagged, server_time: now });
});

const heartbeatSchema = z.object({
  agent_id: z.string().max(40).optional(),
  sent_at: z.number().int().optional(),
  queue_length: z.number().int().min(0).max(100_000).optional(),
  serial_ok: z.boolean().optional(),
});

buzzerRoutes.post('/heartbeat', async (c) => {
  const rt = c.var.rt;
  const now = rt.now();
  const { agentId, json } = await verifiedBody(c);
  const parsed = heartbeatSchema.safeParse(json);
  if (!parsed.success) fail(422, 'invalid_payload');
  await setKv(
    c.env.DB,
    `agent:${agentId}`,
    { at: now, queueLength: parsed.data.queue_length ?? 0, serialOk: parsed.data.serial_ok ?? null },
    now,
  );
  rt.waitUntil(tick(rt));
  return c.json({ ok: true, server_time: now, next_tick_at: await upcomingTick(c.env.DB, now) });
});
