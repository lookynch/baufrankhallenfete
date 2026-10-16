import { describe, expect, it } from 'vitest';
import {
  base64UrlDecodeText,
  base64UrlEncodeText,
  decrypt,
  encrypt,
  signValue,
  timingSafeEqual,
  verifySignedValue,
} from '../../src/server/security/crypto.ts';
import { decodeGuest, encodeGuest } from '../../src/server/security/guest.ts';
import { normalizeIp } from '../../src/server/security/ip.ts';
import {
  DEFAULT_PBKDF2_ITERATIONS,
  hashPassword,
  iterationsFrom,
  MAX_PBKDF2_ITERATIONS,
  passwordProblem,
  verifyPassword,
} from '../../src/server/security/password.ts';
import { presenceToken, verifyPresenceToken } from '../../src/server/security/presence.ts';
import { hitRateLimit } from '../../src/server/security/ratelimit.ts';
import { base32Decode, base32Encode, totpCode, verifyTotp } from '../../src/server/security/totp.ts';
import { createTestDb } from '../helpers/d1.ts';

describe('TOTP', () => {
  const rfcSecret = base32Encode(new TextEncoder().encode('12345678901234567890'));

  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('erfüllt RFC-6238-Testvektor bei %i s', async (seconds, expected) => {
    expect(await totpCode(rfcSecret, Math.floor(seconds / 30))).toBe(expected);
  });

  it('akzeptiert benachbarte Zeitschritte und verhindert Wiederverwendung', async () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    const code = await totpCode(rfcSecret, step - 1);
    expect(await verifyTotp(rfcSecret, code, now, 0)).toBe(step - 1);
    expect(await verifyTotp(rfcSecret, code, now, step - 1)).toBeNull();
    expect(await verifyTotp(rfcSecret, await totpCode(rfcSecret, step - 3), now, 0)).toBeNull();
    expect(await verifyTotp(rfcSecret, 'abcdef', now, 0)).toBeNull();
  });

  it('kodiert Base32 verlustfrei', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(Array.from(base32Decode(base32Encode(bytes)))).toEqual(Array.from(bytes));
  });
});

describe('Passwörter', () => {
  it('hasht mit Pepper und prüft korrekt', async () => {
    const hash = await hashPassword('ein sehr gutes Passwort!', 'pepper', 10_000);
    expect(hash).toMatch(/^pbkdf2\$10000\$/);
    expect((await verifyPassword('ein sehr gutes Passwort!', hash, 'pepper')).ok).toBe(true);
    expect((await verifyPassword('ein sehr gutes Passwort?', hash, 'pepper')).ok).toBe(false);
    expect((await verifyPassword('ein sehr gutes Passwort!', hash, 'anderer-pepper')).ok).toBe(false);
  });

  it('hält PBKDF2 im CPU-Budget des Free-Tiers', () => {
    expect(DEFAULT_PBKDF2_ITERATIONS).toBe(20_000);
    expect(MAX_PBKDF2_ITERATIONS).toBe(30_000);
    expect(iterationsFrom(undefined)).toBe(DEFAULT_PBKDF2_ITERATIONS);
    expect(iterationsFrom('abc')).toBe(DEFAULT_PBKDF2_ITERATIONS);
    expect(iterationsFrom('9999')).toBe(DEFAULT_PBKDF2_ITERATIONS);
    expect(iterationsFrom('12000')).toBe(12_000);
    expect(iterationsFrom('50000')).toBe(MAX_PBKDF2_ITERATIONS);
    expect(iterationsFrom('100000')).toBe(MAX_PBKDF2_ITERATIONS);
  });

  it('prüft Hashes mit der gespeicherten Iterationszahl', async () => {
    const hash = await hashPassword('ein sehr gutes Passwort!', 'pepper', 12_000);
    expect(await verifyPassword('ein sehr gutes Passwort!', hash, 'pepper')).toEqual({ ok: true, iterations: 12_000 });
  });

  it('lehnt schwache Passwörter ab', () => {
    expect(passwordProblem('kurz', 'anna')).toBe('password_too_short');
    expect(passwordProblem('anna-ist-die-beste', 'anna')).toBe('password_contains_username');
    expect(passwordProblem('aaaaaaaaaaaaaa', 'bob')).toBe('password_too_simple');
    expect(passwordProblem('Passwort1234', 'bob')).toBe('password_too_common');
    expect(passwordProblem('Grüne Gurken tanzen 7x', 'bob')).toBeNull();
  });
});

describe('Kryptografie-Bausteine', () => {
  it('verschlüsselt und entschlüsselt mit AES-GCM', async () => {
    const cipher = await encrypt('key', 'geheim');
    expect(cipher).not.toContain('geheim');
    expect(await decrypt('key', cipher)).toBe('geheim');
    await expect(decrypt('anderer', cipher)).rejects.toThrow();
  });

  it('erkennt manipulierte signierte Werte', async () => {
    const token = await signValue('secret', 'purpose', { a: 1 });
    expect(await verifySignedValue('secret', 'purpose', token)).toEqual({ a: 1 });
    expect(await verifySignedValue('secret', 'anderer-zweck', token)).toBeNull();
    const [, signature] = token.split('.');
    const forged = `${base64UrlEncodeText(JSON.stringify({ a: 2 }))}.${signature}`;
    expect(await verifySignedValue('secret', 'purpose', forged)).toBeNull();
    expect(base64UrlDecodeText(base64UrlEncodeText('äöü'))).toBe('äöü');
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('IP-Normalisierung', () => {
  it.each([
    ['203.0.113.7', 'v4', 'v4:203.0.113.7'],
    ['::ffff:203.0.113.7', 'v4', 'v4:203.0.113.7'],
    ['2a02:810d:4b3f:1200:aaaa:bbbb:cccc:dddd', 'v6', 'v6:2a02:810d:4b3f:1200::/64'],
    ['2a02:810d:4b3f:1200::1', 'v6', 'v6:2a02:810d:4b3f:1200::/64'],
    ['2A02:810D:4B3F:1200:0:0:0:9', 'v6', 'v6:2a02:810d:4b3f:1200::/64'],
    ['::1', 'v6', 'v6:0:0:0:0::/64'],
    ['nonsense', 'unknown', 'unknown'],
    [null, 'unknown', 'unknown'],
  ])('%s → %s', (input, family, key) => {
    expect(normalizeIp(input)).toEqual({ family, key });
  });
});

describe('Anwesenheits-Token und Gast-Cookie', () => {
  it('akzeptiert aktuellen und vorherigen QR-Token, nicht ältere', async () => {
    const now = 1_800_000_000_000;
    const token = await presenceToken('qr', now);
    expect(token).toMatch(/^[A-Z2-7]{8}$/);
    expect(await verifyPresenceToken('qr', token, now)).toBe(true);
    expect(await verifyPresenceToken('qr', token.toLowerCase(), now + 60_000)).toBe(true);
    expect(await verifyPresenceToken('qr', token, now + 120_000)).toBe(false);
    expect(await verifyPresenceToken('anders', token, now)).toBe(false);
  });

  it('lehnt abgelaufene oder fremd signierte Gast-Cookies ab', async () => {
    const value = await encodeGuest('cookie', { deviceId: 'abc', expiresAt: 2_000 });
    expect(await decodeGuest('cookie', value, 1_000)).toEqual({ deviceId: 'abc', expiresAt: 2_000 });
    const legacy = await signValue('cookie', 'guest', { d: 'abc', v: 0, e: 2_000 });
    expect(await decodeGuest('cookie', legacy, 1_000)).toEqual({ deviceId: 'abc', expiresAt: 2_000 });
    expect(await decodeGuest('cookie', value, 3_000)).toBeNull();
    expect(await decodeGuest('falsch', value, 1_000)).toBeNull();
  });
});

describe('Rate-Limit', () => {
  it('zählt pro Fenster und setzt im nächsten Fenster zurück', async () => {
    const db = createTestDb();
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await hitRateLimit(db, 'k', 3, 60, 120_000));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect((await hitRateLimit(db, 'k', 3, 60, 180_000)).allowed).toBe(true);
  });
});
