import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.ts';
import type { Env } from '../../src/server/env.ts';
import { buzzerSignature } from '../../src/server/routes/buzzer.ts';
import { claimPairing, pollPairing, startPairing } from '../../src/server/services/displays.ts';
import { bookManual, BUCKET_MS, bucketOf, consumptionStats, type Bucket } from '../../src/server/services/ledger.ts';
import { loadSettings, saveSettings } from '../../src/server/services/settings.ts';
import { defaultSettings } from '../../src/shared/settings.ts';
import { FakeSpotify } from '../helpers/fake-spotify.ts';
import { Clock, testEnv } from '../helpers/runtime.ts';

const ORIGIN = 'https://fete.example';
const HOUR = 3_600_000;
const MINUTE = 60_000;
const EVENING = Date.UTC(2026, 10, 20, 17, 0, 0);

function harness(time: number) {
  const clock = new Clock(time);
  const env: Env = testEnv();
  const spotify = new FakeSpotify(clock.now);
  const app = createApp({ now: clock.now, spotify: () => spotify });
  const pending: Promise<unknown>[] = [];
  const request = async (
    path: string,
    init: { body?: string; method?: string; headers?: Record<string, string>; ip?: string },
  ) => {
    const response = await app.request(
      `${ORIGIN}${path}`,
      {
        method: init.method ?? 'POST',
        body: init.body,
        headers: {
          Host: 'fete.example',
          Origin: ORIGIN,
          'Content-Type': 'application/json',
          'CF-Connecting-IP': init.ip ?? '2a02:810d:4b3f:1200::1',
          ...init.headers,
        },
      },
      env,
      { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException: () => {}, props: {} },
    );
    while (pending.length) await pending.shift();
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  };
  return { clock, env, request };
}

async function press(h: ReturnType<typeof harness>, eventId: string, pressedAt: number) {
  const raw = JSON.stringify({ event_id: eventId, pressed_at: pressedAt, source_code: '5393' });
  const timestamp = String(h.clock.time);
  return h.request('/api/buzzer/press', {
    body: raw,
    ip: '10.0.0.5',
    headers: {
      'X-Fete-Agent': 'bar-pc',
      'X-Fete-Timestamp': timestamp,
      'X-Fete-Signature': await buzzerSignature(h.env.BUZZER_HMAC_SECRET, 'POST', '/api/buzzer/press', timestamp, raw),
    },
  });
}

describe('Zeitverankerte Standard-Einstellungen (#16)', () => {
  it('verschiebt das Standard-Eventfenster nach Mitternacht UTC nicht auf den nächsten Tag', () => {
    const before = defaultSettings(EVENING + 6 * HOUR + 59 * MINUTE);
    const after = defaultSettings(EVENING + 7 * HOUR + MINUTE);
    expect(before.event.startsAt).toBe(EVENING);
    expect(after.event).toEqual(before.event);
    expect(after.voting.startsAt).toBe(before.voting.startsAt);
  });

  it('schreibt beim Laden nichts und fixiert das Fenster nicht auf den Tag des ersten Aufrufs', async () => {
    const env = testEnv();
    const setupDay = await loadSettings(env.DB, EVENING - 9 * 24 * HOUR + 3 * HOUR);
    expect(setupDay.event.startsAt).toBe(EVENING - 9 * 24 * HOUR);
    const stored = await env.DB.prepare('SELECT COUNT(*) AS n FROM settings').first<{ n: number }>();
    expect(stored?.n).toBe(0);
    const party = await loadSettings(env.DB, EVENING + 2 * HOUR);
    expect(party.event).toMatchObject({ startsAt: EVENING, endsAt: EVENING + 7 * HOUR });
    expect(party.voting.startsAt).toBe(EVENING + HOUR);
    expect(party.voting.endsAt).toBeNull();
  });

  it('überschreibt gespeicherte Einstellungen nicht', async () => {
    const env = testEnv();
    await saveSettings(env.DB, 'event', { startsAt: EVENING + HOUR, endsAt: EVENING + 9 * HOUR }, EVENING, null);
    const settings = await loadSettings(env.DB, EVENING + 30 * HOUR);
    expect(settings.event).toMatchObject({ startsAt: EVENING + HOUR, endsAt: EVENING + 9 * HOUR });
  });

  it('bucht Buzzer-Drücke nach 00:00 UTC weiter und die Bar-Statistik zählt sie mit', async () => {
    const h = harness(EVENING - HOUR);
    await loadSettings(h.env.DB, h.clock.time);
    h.clock.time = EVENING + 7 * HOUR + 30 * MINUTE;
    const result = await press(h, '7c9e6679-7425-40de-944b-e07fc1f90ae7', h.clock.time - MINUTE);
    expect(result.status).toBe(200);
    expect(result.json.status).toBe('accepted');
    const settings = await loadSettings(h.env.DB, h.clock.time);
    expect(settings.event.startsAt).toBe(EVENING);
  });
});

describe('Kisten-Rate der letzten Stunde (#36)', () => {
  const settings = {
    ...defaultSettings(EVENING),
    event: { name: 'x', startsAt: EVENING, endsAt: EVENING + 7 * HOUR },
  };

  function steadyRows(until: number): Bucket[] {
    const rows: Bucket[] = [];
    for (let at = EVENING; at <= bucketOf(until); at += BUCKET_MS) {
      const crates = at === bucketOf(until) ? Math.floor((until - at) / (5 * MINUTE)) : 3;
      rows.push({ bucket_start: at, crates, cost_cents: crates * settings.ledger.cratePriceCents });
    }
    return rows;
  }

  it.each([1, 7, 14])('liefert bei gleichmäßig 12 Kisten/h exakt 12 (%i min nach Bucketgrenze)', (offset) => {
    const now = EVENING + 3 * HOUR + offset * MINUTE;
    const stats = consumptionStats(steadyRows(now), settings, now);
    expect(stats.cratesLastHour).toBe(12);
    expect(stats.ratePerHour).toBe(12);
    expect(stats.forecastCrates).toBe(
      Math.round(36 + Math.floor(offset / 5) + 12 * ((4 * HOUR - offset * MINUTE) / HOUR)),
    );
  });
});

describe('Ledger-Konten in den Einstellungen (#37)', () => {
  it('lehnt gleiche Konten ab', async () => {
    const env = testEnv();
    await expect(
      saveSettings(env.DB, 'ledger', { inventoryAccount: '3980', expenseAccount: '3980' }, EVENING, null),
    ).rejects.toThrow('ledger_accounts_must_differ');
    await expect(
      saveSettings(env.DB, 'ledger', { inventoryAccount: '1600', payableAccount: '1600' }, EVENING, null),
    ).rejects.toThrow('ledger_accounts_must_differ');
  });

  it('lehnt unbekannte Konten ab und speichert nichts', async () => {
    const env = testEnv();
    await expect(saveSettings(env.DB, 'ledger', { expenseAccount: '4410' }, EVENING, null)).rejects.toThrow(
      'unknown_ledger_account',
    );
    expect((await loadSettings(env.DB, EVENING)).ledger.expenseAccount).toBe('4140');
  });

  it('akzeptiert vorhandene, verschiedene Konten', async () => {
    const env = testEnv();
    const { after } = await saveSettings(env.DB, 'ledger', { payableAccount: '1000' }, EVENING, null);
    expect(after.payableAccount).toBe('1000');
  });
});

describe('Display-Kopplung (#38, #39)', () => {
  it('blockiert den Poll mit richtigem Geheimnis nicht, auch wenn Fremde den Code mit falschem fluten', async () => {
    const h = harness(EVENING);
    const start = await h.request('/api/display/pair/start', { body: '{}' });
    const code = start.json.code as string;
    const secret = start.json.secret as string;
    let last = 0;
    for (let i = 0; i < 40; i++) {
      const attack = await h.request('/api/display/pair/poll', {
        body: JSON.stringify({ code, secret: 'x'.repeat(32) }),
        ip: '2a02:810d:4b3f:1200::66',
      });
      last = attack.status;
      if (attack.status === 200) expect(attack.json.status).toBe('expired');
    }
    expect(last).toBe(429);
    for (const ip of ['2a02:810d:4b3f:1200::66', '2a02:810d:4b3f:1200::1']) {
      const poll = await h.request('/api/display/pair/poll', { body: JSON.stringify({ code, secret }), ip });
      expect(poll.status).toBe(200);
      expect(poll.json.status).toBe('pending');
    }
  });

  it('liefert das Token erneut, wenn die erste Antwort verloren geht', async () => {
    const env = testEnv();
    const pairing = await startPairing(env.DB, EVENING);
    await claimPairing(env.DB, env.ENC_KEY, { code: pairing.code, name: 'Bar', kind: 'bar_stats' }, 1, EVENING);
    const first = await pollPairing(env.DB, env.ENC_KEY, pairing.code, pairing.secret, EVENING + 1_000);
    const retry = await pollPairing(env.DB, env.ENC_KEY, pairing.code, pairing.secret, EVENING + 6_000);
    expect(first.status).toBe('paired');
    expect(retry).toEqual(first);
    expect(await pollPairing(env.DB, env.ENC_KEY, pairing.code, 'y'.repeat(32), EVENING + 7_000)).toEqual({
      status: 'invalid',
    });
  });

  it('gibt einem kurz vor Ablauf freigegebenen Pairing noch ein Zustellfenster', async () => {
    const env = testEnv();
    const pairing = await startPairing(env.DB, EVENING);
    const claimAt = pairing.expiresAt - 1_000;
    await claimPairing(env.DB, env.ENC_KEY, { code: pairing.code, name: 'TV', kind: 'tv' }, 1, claimAt);
    const late = await pollPairing(env.DB, env.ENC_KEY, pairing.code, pairing.secret, pairing.expiresAt + 30_000);
    expect(late.status).toBe('paired');
  });

  it('räumt das Pairing nach der Zustellfrist ab', async () => {
    const env = testEnv();
    const pairing = await startPairing(env.DB, EVENING);
    await claimPairing(env.DB, env.ENC_KEY, { code: pairing.code, name: 'TV', kind: 'tv' }, 1, EVENING);
    await pollPairing(env.DB, env.ENC_KEY, pairing.code, pairing.secret, EVENING + 1_000);
    expect(await pollPairing(env.DB, env.ENC_KEY, pairing.code, pairing.secret, EVENING + 3 * MINUTE)).toEqual({
      status: 'expired',
    });
    await startPairing(env.DB, EVENING + 3 * MINUTE);
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM display_pairings WHERE code = ?1')
      .bind(pairing.code)
      .first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});

describe('Bar-Ledger-Display', () => {
  it('liefert Buchungen ohne Admin-Kennung', async () => {
    const h = harness(EVENING);
    const db = h.env.DB;
    await db
      .prepare(
        "INSERT INTO admin_users (id, username, display_name, role, password_hash, totp_secret_enc, created_at) VALUES (1, 'anna', 'Anna', 'owner', 'x', 'x', 0)",
      )
      .run();
    const input = {
      kind: 'purchase' as const,
      debitAccount: '3980',
      creditAccount: '1600',
      amountCents: 4_200,
      quantity: 0,
      text: 'Getränkeeinkauf',
      effectiveAt: EVENING,
    };
    await bookManual(db, input, 1, EVENING);
    const pairing = await startPairing(db, EVENING);
    await claimPairing(db, h.env.ENC_KEY, { code: pairing.code, name: 'Bar', kind: 'bar_ledger' }, 1, EVENING);
    const paired = await pollPairing(db, h.env.ENC_KEY, pairing.code, pairing.secret, EVENING);
    if (paired.status !== 'paired') throw new Error(paired.status);
    const state = await h.request('/api/display/state', {
      method: 'GET',
      headers: { Cookie: `__Host-display=${paired.token}` },
    });
    const journal = state.json.journal as Array<Record<string, unknown>>;
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ booking_no: 'BF-0001', text: 'Getränkeeinkauf' });
    expect(journal[0]).not.toHaveProperty('created_by');
    expect(journal[0]).not.toHaveProperty('created_by_name');
  });
});
