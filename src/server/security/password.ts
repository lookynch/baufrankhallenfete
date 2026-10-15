import { base64UrlDecode, base64UrlEncode, hmacBytes, randomBytes, timingSafeEqual } from './crypto.ts';

export const DEFAULT_PBKDF2_ITERATIONS = 50_000;
const MAX_ITERATIONS = 100_000;
const MIN_LENGTH = 12;

const commonPasswords = new Set([
  'passwort1234',
  'password1234',
  '123456789012',
  'qwertzuiop12',
  'qwertyuiop12',
  'baufrankhalle',
  'jeremias1234',
  'fete20262026',
  'sommerfest2026',
  'winterfest2026',
]);

export function passwordProblem(password: string, username: string): string | null {
  if (password.length < MIN_LENGTH) return 'password_too_short';
  if (password.length > 256) return 'password_too_long';
  const lower = password.toLowerCase();
  if (commonPasswords.has(lower)) return 'password_too_common';
  if (lower.includes(username.toLowerCase())) return 'password_contains_username';
  if (new Set(password).size < 5) return 'password_too_simple';
  return null;
}

async function derive(password: string, pepper: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const peppered = await hmacBytes(pepper, password);
  const key = await crypto.subtle.importKey('raw', peppered, 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256),
  );
}

export function iterationsFrom(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 10_000) return DEFAULT_PBKDF2_ITERATIONS;
  return Math.min(parsed, MAX_ITERATIONS);
}

export async function hashPassword(password: string, pepper: string, iterations: number): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, pepper, salt, iterations);
  return `pbkdf2$${iterations}$${base64UrlEncode(salt)}$${base64UrlEncode(hash)}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
  pepper: string,
): Promise<{ ok: boolean; iterations: number }> {
  const [scheme, iter, salt, hash] = stored.split('$');
  const iterations = Number(iter);
  if (scheme !== 'pbkdf2' || !salt || !hash || !Number.isInteger(iterations)) return { ok: false, iterations: 0 };
  const candidate = await derive(password, pepper, base64UrlDecode(salt), iterations);
  return { ok: timingSafeEqual(base64UrlEncode(candidate), hash), iterations };
}

export async function dummyPasswordWork(pepper: string, iterations: number): Promise<void> {
  await derive('dummy-password-for-timing', pepper, randomBytes(16), iterations);
}
