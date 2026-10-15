import { describe, expect, it } from 'vitest';
import { contrastPairs, contrastRatio, theme } from '../../src/shared/theme.ts';
import { defaultSettings } from '../../src/shared/settings.ts';
import { planLevel } from '../../src/server/services/levels.ts';
import {
  assertNoOverlap,
  normalizeArtist,
  normalizeTitle,
  setActiveAt,
  tracksMatch,
} from '../../src/server/services/library.ts';
import {
  accountBalances,
  bookBuzzerPress,
  bookManual,
  buckets,
  consumptionStats,
  reverseEntry,
} from '../../src/server/services/ledger.ts';
import { castVote, ipVoteLimit } from '../../src/server/services/votes.ts';
import { parseSpotifyReference } from '../../src/server/services/spotify-api.ts';
import { createTestDb } from '../helpers/d1.ts';

const HOUR = 3_600_000;

describe('Theme', () => {
  it.each(contrastPairs)('%s auf %s erfüllt WCAG AA (≥ 4,5:1)', (fg, bg) => {
    expect(contrastRatio(theme.colors[fg], theme.colors[bg])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('Stimmungsplanung', () => {
  const sets = [
    { id: 1, name: 'Warm-up', starts_at: 0, ends_at: 4 * HOUR, default_level: 2 },
    { id: 2, name: 'Party', starts_at: 4 * HOUR, ends_at: 8 * HOUR, default_level: 5 },
  ];
  const base = { maxStep: 1, overrideTarget: null, sets, roundMs: 20 * 60_000, isAvailable: () => true };

  it('springt nie mehr als eine Stufe', () => {
    expect(planLevel({ ...base, previousLevel: 2, expectedPlayAt: 5 * HOUR }).level).toBe(3);
    expect(planLevel({ ...base, previousLevel: 5, expectedPlayAt: HOUR }).level).toBe(4);
  });

  it('beginnt die Rampe rechtzeitig vor dem Set-Wechsel', () => {
    expect(planLevel({ ...base, previousLevel: 2, expectedPlayAt: HOUR }).level).toBe(2);
    expect(planLevel({ ...base, previousLevel: 2, expectedPlayAt: 4 * HOUR - 50 * 60_000 }).level).toBe(3);
  });

  it('weicht bei fehlenden Songs auf das nächstliegende Level aus', () => {
    const plan = planLevel({ ...base, previousLevel: 2, expectedPlayAt: 5 * HOUR, isAvailable: (l) => l !== 3 });
    expect(plan.level).toBe(2);
    expect(plan.constrained).toBe(true);
  });

  it('respektiert den Admin-Zielwert schrittweise', () => {
    expect(planLevel({ ...base, overrideTarget: 5, previousLevel: 2, expectedPlayAt: HOUR }).level).toBe(3);
  });
});

describe('Bibliothek', () => {
  it('erkennt das aktive bzw. vorherige Set', () => {
    const sets = [
      { id: 1, name: 'A', starts_at: 10, ends_at: 20, default_level: 2 },
      { id: 2, name: 'B', starts_at: 30, ends_at: 40, default_level: 4 },
    ];
    expect(setActiveAt(sets, 15)?.id).toBe(1);
    expect(setActiveAt(sets, 25)?.id).toBe(1);
    expect(setActiveAt(sets, 5)?.id).toBe(1);
    expect(setActiveAt(sets, 45)?.id).toBe(2);
  });

  it('verbietet überlappende Sets', () => {
    const sets = [{ id: 1, name: 'A', starts_at: 10, ends_at: 20, default_level: 2 }];
    expect(() => assertNoOverlap(sets, { name: 'B', starts_at: 15, ends_at: 25, default_level: 3 })).toThrow(
      'set_overlaps',
    );
    expect(() => assertNoOverlap(sets, { name: 'B', starts_at: 20, ends_at: 25, default_level: 3 })).not.toThrow();
  });

  it('gleicht Relinking über ISRC oder normalisierten Titel ab', () => {
    const stored = {
      spotify_uri: 'spotify:track:a',
      isrc: 'DEAAA1',
      title_norm: normalizeTitle('Song (Remastered 2011)'),
      artist_norm: normalizeArtist('Band feat. Gast'),
      duration_ms: 200_000,
    };
    expect(
      tracksMatch({ uri: 'spotify:track:b', isrc: 'DEAAA1', title: 'x', artist: 'y', durationMs: 1 }, stored),
    ).toBe(true);
    expect(
      tracksMatch({ uri: 'spotify:track:b', isrc: null, title: 'Song', artist: 'Band', durationMs: 201_000 }, stored),
    ).toBe(true);
    expect(
      tracksMatch({ uri: 'spotify:track:b', isrc: null, title: 'Song', artist: 'Band', durationMs: 230_000 }, stored),
    ).toBe(false);
  });

  it('liest Spotify-Links und URIs', () => {
    expect(parseSpotifyReference('https://open.spotify.com/intl-de/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc')).toEqual({
      kind: 'playlist',
      id: '37i9dQZF1DXcBWIGoYBM5M',
    });
    expect(parseSpotifyReference('spotify:track:4uLU6hMCjMI75M1A2tKUQC')).toEqual({
      kind: 'track',
      id: '4uLU6hMCjMI75M1A2tKUQC',
    });
    expect(parseSpotifyReference('https://evil.example/playlist/37i9dQZF1DXcBWIGoYBM5M')).toBeNull();
  });
});

describe('Buchhaltung', () => {
  const settings = { ...defaultSettings(0), event: { name: 'x', startsAt: 0, endsAt: 6 * HOUR } };

  it('bucht Buzzer-Drücke idempotent, Soll = Haben, und storniert sauber', async () => {
    const db = createTestDb();
    const press = {
      eventId: '1b4e28ba-2fa1-11d2-883f-0016d3cca427',
      agentId: 'bar',
      sourceCode: '1',
      pressedAt: HOUR,
      receivedAt: HOUR,
    };
    const first = await bookBuzzerPress(db, settings, press);
    const again = await bookBuzzerPress(db, settings, press);
    expect(first.status).toBe('accepted');
    expect(first.bookingNo).toBe('BF-0001');
    expect(again.status).toBe('duplicate');

    const second = await bookBuzzerPress(db, settings, {
      ...press,
      eventId: '2b4e28ba-2fa1-11d2-883f-0016d3cca427',
      pressedAt: HOUR + 1000,
    });
    expect(second.flagged).toBe(true);
    expect(second.bookingNo).toBe('BF-0002');

    let stats = consumptionStats(await buckets(db, 0, 6 * HOUR), settings, 2 * HOUR);
    expect(stats.totalCrates).toBe(2);
    expect(stats.totalCostCents).toBe(2 * settings.ledger.cratePriceCents);

    await reverseEntry(db, 2, 1, 2 * HOUR, 'Doppeldruck');
    await expect(reverseEntry(db, 2, 1, 2 * HOUR, 'nochmal')).rejects.toThrow('already_reversed');
    await expect(reverseEntry(db, 3, 1, 2 * HOUR, 'Storno vom Storno')).rejects.toThrow('cannot_reverse_reversal');
    stats = consumptionStats(await buckets(db, 0, 6 * HOUR), settings, 2 * HOUR);
    expect(stats.totalCrates).toBe(1);

    await bookManual(
      db,
      {
        kind: 'purchase',
        debitAccount: '3980',
        creditAccount: '1600',
        amountCents: 50_000,
        quantity: 0,
        text: 'Lieferung',
        effectiveAt: 0,
      },
      1,
      0,
    );
    const balances = await accountBalances(db);
    const debit = balances.reduce((s, a) => s + a.debit_cents, 0);
    const credit = balances.reduce((s, a) => s + a.credit_cents, 0);
    expect(debit).toBe(credit);
    const inventory = balances.find((a) => a.code === '3980')!;
    expect(inventory.debit_cents - inventory.credit_cents).toBe(50_000 - settings.ledger.cratePriceCents);
  });

  it('weist ungültige manuelle Buchungen ab', async () => {
    const db = createTestDb();
    const base = {
      kind: 'manual' as const,
      debitAccount: '3980',
      creditAccount: '1600',
      amountCents: 100,
      quantity: 0,
      text: 't',
      effectiveAt: 0,
    };
    await expect(bookManual(db, { ...base, creditAccount: '3980' }, 1, 0)).rejects.toThrow('same_account');
    await expect(bookManual(db, { ...base, debitAccount: '9999' }, 1, 0)).rejects.toThrow('unknown_account');
  });
});

describe('Stimmen', () => {
  async function roundWithCandidates() {
    const db = createTestDb();
    await db.batch([
      db.prepare(
        "INSERT INTO songs (id, spotify_uri, title, artist, duration_ms, title_norm, artist_norm, created_at) VALUES (1, 'spotify:track:aaaaaaaaaa', 'A', 'X', 1, 'a', 'x', 0), (2, 'spotify:track:bbbbbbbbbb', 'B', 'X', 1, 'b', 'x', 0)",
      ),
      db.prepare("INSERT INTO rounds (id, seq, status, mood_level, opened_at) VALUES (1, 1, 'open', 2, 0)"),
      db.prepare(
        'INSERT INTO round_candidates (round_id, song_id, position, tiebreak) VALUES (1, 1, 1, 1), (1, 2, 2, 2)',
      ),
    ]);
    return db;
  }
  const settings = defaultSettings(0);
  const vote = (deviceId: string, ipKey: string, songId = 1, verified = true, ipFamily: 'v4' | 'v6' = 'v6') => ({
    roundId: 1,
    songId,
    deviceId,
    ipKey,
    ipFamily,
    verified,
    fpHash: null,
    now: 1,
  });

  it('erlaubt Stimmänderung auch bei IP-Limit 1', async () => {
    const db = await roundWithCandidates();
    expect(await castVote(db, settings, vote('d1', 'ip1'))).toBe('ok');
    expect(await castVote(db, settings, vote('d1', 'ip1', 2))).toBe('ok');
    expect(await castVote(db, settings, vote('d2', 'ip1'))).toBe('ip_limit');
    const row = await db
      .prepare('SELECT song_id FROM votes WHERE device_id = ?1')
      .bind('d1')
      .first<{ song_id: number }>();
    expect(row?.song_id).toBe(2);
  });

  it('erlaubt mehrere Geräte hinter geteilter IPv4, unverifizierte nur eins', async () => {
    const db = await roundWithCandidates();
    expect(ipVoteLimit(settings, 'v4', true)).toBe(3);
    expect(ipVoteLimit(settings, 'v4', false)).toBe(1);
    expect(await castVote(db, settings, vote('d1', 'nat', 1, true, 'v4'))).toBe('ok');
    expect(await castVote(db, settings, vote('d2', 'nat', 1, false, 'v4'))).toBe('ip_limit');
    expect(await castVote(db, settings, vote('d3', 'nat', 1, true, 'v4'))).toBe('ok');
    expect(await castVote(db, settings, vote('d4', 'nat', 1, true, 'v4'))).toBe('ok');
    expect(await castVote(db, settings, vote('d5', 'nat', 1, true, 'v4'))).toBe('ip_limit');
  });

  it('lehnt Stimmen für geschlossene Runden und Nicht-Kandidaten ab', async () => {
    const db = await roundWithCandidates();
    expect(await castVote(db, settings, { ...vote('d1', 'ip'), songId: 99 })).toBe('not_candidate');
    await db.prepare("UPDATE rounds SET status = 'closed'").run();
    expect(await castVote(db, settings, vote('d1', 'ip'))).toBe('round_closed');
  });
});
