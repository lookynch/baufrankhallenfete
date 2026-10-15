import { randomToken, signValue, verifySignedValue } from './crypto.ts';

export const GUEST_COOKIE = '__Host-fete';

export interface GuestIdentity {
  deviceId: string;
  verified: boolean;
  expiresAt: number;
}

interface GuestPayload {
  d: string;
  v: 0 | 1;
  e: number;
}

export function newDeviceId(): string {
  return randomToken(18);
}

export async function encodeGuest(secret: string, identity: GuestIdentity): Promise<string> {
  const payload: GuestPayload = { d: identity.deviceId, v: identity.verified ? 1 : 0, e: identity.expiresAt };
  return signValue(secret, 'guest', payload);
}

export async function decodeGuest(
  secret: string,
  value: string | undefined,
  now: number,
): Promise<GuestIdentity | null> {
  const payload = await verifySignedValue<GuestPayload>(secret, 'guest', value);
  if (!payload || typeof payload.d !== 'string' || typeof payload.e !== 'number' || payload.e < now) return null;
  return { deviceId: payload.d, verified: payload.v === 1, expiresAt: payload.e };
}
