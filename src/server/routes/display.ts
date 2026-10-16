import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Settings } from '../../shared/settings.ts';
import { body, clientIpHash, fail, type AppContext, type AppEnv } from '../http.ts';
import { presenceToken } from '../security/presence.ts';
import { hitRateLimit } from '../security/ratelimit.ts';
import { readBudget, refreshBudget, throttleFactor } from '../services/budget.ts';
import {
  authenticateDisplay,
  DISPLAY_COOKIE,
  pollPairing,
  startPairing,
  type DisplayRow,
} from '../services/displays.ts';
import { accountBalances, bookingNo, buckets, consumptionStats, journal } from '../services/ledger.ts';
import { activeEntries, computeSchedule, nextTickAt } from '../services/playback.ts';
import { expectedCloseAt, openRound, votingActive } from '../services/rounds.ts';
import { loadSettings } from '../services/settings.ts';
import { readSnapshot, tick } from '../services/tick.ts';
import { wishKey } from '../services/wishes.ts';
import { nowPlayingView, roundView, upNextView } from '../views.ts';

export const displayRoutes = new Hono<AppEnv>();

displayRoutes.post('/pair/start', async (c) => {
  const now = c.var.rt.now();
  const limited = await hitRateLimit(c.env.DB, `pair-start:${await clientIpHash(c)}`, 10, 600, now);
  if (!limited.allowed) fail(429, 'rate_limited');
  return c.json(await startPairing(c.env.DB, now));
});

displayRoutes.post('/pair/poll', async (c) => {
  const now = c.var.rt.now();
  const input = await body(c, z.object({ code: z.string().regex(/^\d{6}$/), secret: z.string().min(20).max(64) }));
  const result = await pollPairing(c.env.DB, c.env.ENC_KEY, input.code, input.secret, now);
  if (result.status === 'invalid') {
    const limited = await hitRateLimit(c.env.DB, `pair-poll-fail:${await clientIpHash(c)}`, 30, 600, now);
    if (!limited.allowed) fail(429, 'rate_limited');
    return c.json({ status: 'expired' });
  }
  if (result.status !== 'paired') return c.json(result);
  setCookie(c, DISPLAY_COOKIE, result.token, {
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Strict',
    maxAge: 60 * 24 * 3600,
  });
  return c.json({ status: 'paired', kind: result.kind });
});

displayRoutes.post('/unpair', (c) => {
  deleteCookie(c, DISPLAY_COOKIE, { path: '/', secure: true });
  return c.json({ ok: true });
});

async function requireDisplay(c: AppContext): Promise<DisplayRow> {
  const display = await authenticateDisplay(c.env.DB, getCookie(c, DISPLAY_COOKIE), c.var.rt.now());
  if (!display) fail(401, 'display_not_paired');
  return display;
}

displayRoutes.get('/state', async (c) => {
  const display = await requireDisplay(c);
  const rt = c.var.rt;
  const now = rt.now();
  const settings = await loadSettings(c.env.DB, now);
  const base = { now, kind: display.kind, name: display.name, eventName: settings.event.name };
  if (display.kind === 'tv' || display.kind === 'player') {
    rt.waitUntil(tick(rt).then(() => refreshBudget(c.env, rt.now())));
    return c.json({ ...base, ...(await musicState(c, settings, now, display.kind === 'tv')) });
  }
  const pollAfterMs = settings.polling.barMs * throttleFactor(await readBudget(c.env.DB), now);
  if (display.kind === 'bar_stats')
    return c.json({ ...base, pollAfterMs, ...(await statsState(c.env.DB, settings, now)) });
  return c.json({ ...base, pollAfterMs, ...(await ledgerState(c.env.DB, settings, now)) });
});

async function musicState(c: AppContext, settings: Settings, now: number, tv: boolean) {
  const db = c.env.DB;
  const snapshot = await readSnapshot(db);
  const schedule = computeSchedule(await activeEntries(db), now, snapshot);
  const round = await openRound(db);
  const closeAt = round ? expectedCloseAt(round, schedule) : null;
  const pollAfterMs = tv ? settings.polling.tvMs : settings.polling.playerMs;
  const common = {
    pollAfterMs,
    nextTickAt: nextTickAt(schedule, closeAt, now),
    nowPlaying: nowPlayingView(snapshot),
    spotifyError: snapshot?.error ?? null,
    upNext: upNextView(schedule, tv ? 8 : 2),
  };
  if (!tv) return common;
  const ticker = await db
    .prepare(
      `SELECT w.id, s.title, s.artist FROM wishes w JOIN songs s ON s.id = w.song_id
       WHERE w.status = 'approved' ORDER BY w.decided_at DESC LIMIT 6`,
    )
    .all<{ id: number; title: string; artist: string }>();
  return {
    ...common,
    voting: { active: votingActive(settings, now), startsAt: settings.voting.startsAt, endsAt: settings.voting.endsAt },
    round: round ? await roundView(db, round, now, { includeTally: true, schedule }) : null,
    presence: { token: await presenceToken(c.env.QR_SECRET, now), validForMs: 60_000 - (now % 60_000) },
    ticker: ticker.results.map((w) => ({ key: wishKey(w.id), title: w.title, artist: w.artist })),
  };
}

async function statsState(db: D1Database, settings: Settings, now: number) {
  const rows = await buckets(db, settings.event.startsAt - 6 * 3_600_000, now + 60_000);
  const recent = await db
    .prepare(
      `SELECT id, effective_at FROM ledger_entries
       WHERE kind = 'consumption' AND quantity > 0 AND id NOT IN (SELECT reversal_of FROM ledger_entries WHERE reversal_of IS NOT NULL)
       ORDER BY effective_at DESC LIMIT 6`,
    )
    .all<{ id: number; effective_at: number }>();
  return {
    event: { startsAt: settings.event.startsAt, endsAt: settings.event.endsAt },
    cratePriceCents: settings.ledger.cratePriceCents,
    budgetCents: settings.ledger.budgetCents,
    stats: consumptionStats(rows, settings, now),
    recent: recent.results.map((r) => ({ bookingNo: bookingNo(r.id), at: r.effective_at })),
  };
}

async function ledgerState(db: D1Database, settings: Settings, now: number) {
  const rows = await buckets(db, settings.event.startsAt - 6 * 3_600_000, now + 60_000);
  const stats = consumptionStats(rows, settings, now);
  return {
    budgetCents: settings.ledger.budgetCents,
    cratePriceCents: settings.ledger.cratePriceCents,
    totalCostCents: stats.totalCostCents,
    totalCrates: stats.totalCrates,
    forecastCostCents: stats.forecastCostCents,
    costPerHourCents: Math.round(stats.ratePerHour * settings.ledger.cratePriceCents),
    journal: (await journal(db, 14)).map(({ created_by: _id, created_by_name: _name, ...entry }) => entry),
    balances: (await accountBalances(db)).filter((a) => a.debit_cents > 0 || a.credit_cents > 0),
  };
}
