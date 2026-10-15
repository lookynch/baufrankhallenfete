import { hmacBytes } from './crypto.ts';
import { base32Encode } from './totp.ts';

export const PRESENCE_BUCKET_MS = 60_000;

export async function presenceToken(secret: string, now: number): Promise<string> {
  const bucket = Math.floor(now / PRESENCE_BUCKET_MS);
  return base32Encode((await hmacBytes(secret, `presence:${bucket}`)).slice(0, 5));
}

export async function verifyPresenceToken(secret: string, token: string, now: number): Promise<boolean> {
  const normalized = token.trim().toUpperCase();
  if (!/^[A-Z2-7]{8}$/.test(normalized)) return false;
  const current = await presenceToken(secret, now);
  const previous = await presenceToken(secret, now - PRESENCE_BUCKET_MS);
  return normalized === current || normalized === previous;
}
