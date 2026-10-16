import { z } from 'zod';
import { base64UrlDecode, base64UrlDecodeText, base64UrlEncode, randomToken, sha256Hex } from './crypto.ts';

export const CHALLENGE_TTL_MS = 5 * 60_000;
const ES256 = -7;
const RS256 = -257;
const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_CREDENTIAL = 0x40;
const MAX_CREDENTIAL_ID_BYTES = 1023;

export type ChallengePurpose = 'register_invite' | 'register_account' | 'login' | 'reauth';

export interface RelyingParty {
  id: string;
  origin: string;
  name: string;
}

export interface CredentialDescriptor {
  credentialId: string;
  transports: string[];
}

export interface NewPasskey {
  credentialId: string;
  publicKey: string;
  signCount: number;
  transports: string[];
}

interface ClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin?: boolean;
}

const base64Url = z
  .string()
  .max(8192)
  .regex(/^[A-Za-z0-9_-]*$/);
const credentialId = base64Url.min(16).max(1400);

export const registrationCredentialSchema = z.object({
  id: credentialId,
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: base64Url,
    attestationObject: base64Url,
    transports: z.array(z.string().max(20)).max(10).optional(),
  }),
});

export const authenticationCredentialSchema = z.object({
  id: credentialId,
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: base64Url,
    authenticatorData: base64Url,
    signature: base64Url,
    userHandle: base64Url.nullish(),
  }),
});

export type RegistrationCredential = z.infer<typeof registrationCredentialSchema>;
export type AuthenticationCredential = z.infer<typeof authenticationCredentialSchema>;

export function relyingParty(origin: string | undefined, name: string): RelyingParty | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    return { id: url.hostname, origin: url.origin, name };
  } catch {
    return null;
  }
}

export async function issueChallenge(
  db: D1Database,
  purpose: ChallengePurpose,
  subject: string | null,
  webauthnUserId: string | null,
  now: number,
): Promise<string> {
  const challenge = randomToken(32);
  await db
    .prepare(
      `INSERT INTO webauthn_challenges (challenge_hash, purpose, subject, webauthn_user_id, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(await sha256Hex(challenge), purpose, subject, webauthnUserId, now + CHALLENGE_TTL_MS)
    .run();
  return challenge;
}

export async function consumeChallenge(
  db: D1Database,
  challenge: string,
  purpose: ChallengePurpose,
  subject: string | null,
  now: number,
): Promise<{ webauthn_user_id: string | null } | null> {
  return db
    .prepare(
      `DELETE FROM webauthn_challenges
       WHERE challenge_hash = ?1 AND purpose = ?2 AND subject IS ?3 AND expires_at > ?4
       RETURNING webauthn_user_id`,
    )
    .bind(await sha256Hex(challenge), purpose, subject, now)
    .first();
}

export function registrationOptions(
  rp: RelyingParty,
  challenge: string,
  user: { webauthnUserId: string; username: string; displayName: string },
  exclude: CredentialDescriptor[],
) {
  return {
    challenge,
    rp: { id: rp.id, name: rp.name },
    user: { id: user.webauthnUserId, name: user.username, displayName: user.displayName },
    pubKeyCredParams: [
      { type: 'public-key', alg: ES256 },
      { type: 'public-key', alg: RS256 },
    ],
    timeout: CHALLENGE_TTL_MS,
    attestation: 'none',
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    excludeCredentials: exclude.map(descriptor),
  };
}

export function authenticationOptions(rp: RelyingParty, challenge: string, allow: CredentialDescriptor[]) {
  return {
    challenge,
    rpId: rp.id,
    timeout: CHALLENGE_TTL_MS,
    userVerification: 'required',
    allowCredentials: allow.map(descriptor),
  };
}

function descriptor(credential: CredentialDescriptor) {
  return { type: 'public-key', id: credential.credentialId, transports: credential.transports };
}

export function parseClientData(encoded: string): ClientData | null {
  try {
    const data = JSON.parse(base64UrlDecodeText(encoded)) as Partial<ClientData>;
    if (typeof data.type !== 'string' || typeof data.challenge !== 'string' || typeof data.origin !== 'string') {
      return null;
    }
    return data as ClientData;
  } catch {
    return null;
  }
}

export async function verifyRegistration(
  rp: RelyingParty,
  credential: RegistrationCredential,
  clientData: ClientData,
): Promise<NewPasskey | null> {
  try {
    if (!clientDataMatches(rp, clientData, 'webauthn.create')) return null;
    const attestation = decodeCbor(base64UrlDecode(credential.response.attestationObject));
    const authData = attestation instanceof Map ? attestation.get('authData') : null;
    if (!(authData instanceof Uint8Array)) return null;
    const parsed = parseAuthenticatorData(authData);
    if (!(await authenticatorDataMatches(rp, parsed)) || !parsed.attested) return null;
    const id = base64UrlEncode(parsed.attested.credentialId);
    if (id !== credential.id) return null;
    const jwk = coseToJwk(parsed.attested.publicKey);
    if (!jwk) return null;
    await importVerifyKey(jwk);
    return {
      credentialId: id,
      publicKey: JSON.stringify(jwk),
      signCount: parsed.signCount,
      transports: credential.response.transports ?? [],
    };
  } catch {
    return null;
  }
}

export async function verifyAuthentication(
  rp: RelyingParty,
  credential: AuthenticationCredential,
  clientData: ClientData,
  stored: { publicKey: string; signCount: number },
): Promise<{ signCount: number } | null> {
  try {
    if (!clientDataMatches(rp, clientData, 'webauthn.get')) return null;
    const authData = base64UrlDecode(credential.response.authenticatorData);
    const parsed = parseAuthenticatorData(authData);
    if (!(await authenticatorDataMatches(rp, parsed))) return null;
    if ((parsed.signCount !== 0 || stored.signCount !== 0) && parsed.signCount <= stored.signCount) return null;
    const clientDataHash = new Uint8Array(
      await crypto.subtle.digest('SHA-256', base64UrlDecode(credential.response.clientDataJSON)),
    );
    const signed = new Uint8Array(authData.length + clientDataHash.length);
    signed.set(authData);
    signed.set(clientDataHash, authData.length);
    const jwk = JSON.parse(stored.publicKey) as JsonWebKey;
    const valid = await verifySignature(jwk, base64UrlDecode(credential.response.signature), signed);
    return valid ? { signCount: parsed.signCount } : null;
  } catch {
    return null;
  }
}

function clientDataMatches(rp: RelyingParty, clientData: ClientData, type: string): boolean {
  return clientData.type === type && clientData.origin === rp.origin && clientData.crossOrigin !== true;
}

interface AuthenticatorData {
  rpIdHash: Uint8Array;
  flags: number;
  signCount: number;
  attested: { credentialId: Uint8Array<ArrayBuffer>; publicKey: Cbor } | null;
}

function parseAuthenticatorData(data: Uint8Array<ArrayBuffer>): AuthenticatorData {
  if (data.length < 37) throw new Error('authenticator data too short');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const flags = data[32]!;
  const signCount = view.getUint32(33);
  if (!(flags & FLAG_ATTESTED_CREDENTIAL)) return { rpIdHash: data.subarray(0, 32), flags, signCount, attested: null };
  if (data.length < 55) throw new Error('attested credential data too short');
  const idLength = view.getUint16(53);
  if (idLength > MAX_CREDENTIAL_ID_BYTES || 55 + idLength > data.length) throw new Error('invalid credential id');
  const [publicKey] = decodeItem(data, 55 + idLength);
  return {
    rpIdHash: data.subarray(0, 32),
    flags,
    signCount,
    attested: { credentialId: data.slice(55, 55 + idLength), publicKey },
  };
}

async function authenticatorDataMatches(rp: RelyingParty, data: AuthenticatorData): Promise<boolean> {
  const expected = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rp.id)));
  const required = FLAG_USER_PRESENT | FLAG_USER_VERIFIED;
  return (data.flags & required) === required && expected.every((byte, i) => byte === data.rpIdHash[i]);
}

function coseToJwk(key: Cbor): JsonWebKey | null {
  if (!(key instanceof Map)) return null;
  const [kty, alg] = [key.get(1), key.get(3)];
  if (kty === 2 && alg === ES256 && key.get(-1) === 1) {
    const [x, y] = [key.get(-2), key.get(-3)];
    if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) return null;
    return { kty: 'EC', crv: 'P-256', alg: 'ES256', x: base64UrlEncode(x), y: base64UrlEncode(y) };
  }
  if (kty === 3 && alg === RS256) {
    const [n, e] = [key.get(-1), key.get(-2)];
    if (!(n instanceof Uint8Array) || !(e instanceof Uint8Array)) return null;
    return { kty: 'RSA', alg: 'RS256', n: base64UrlEncode(n), e: base64UrlEncode(e) };
  }
  return null;
}

function importVerifyKey(jwk: JsonWebKey): Promise<CryptoKey> {
  const algorithm =
    jwk.kty === 'EC' ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  return crypto.subtle.importKey('jwk', jwk, algorithm, false, ['verify']);
}

async function verifySignature(
  jwk: JsonWebKey,
  signature: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const key = await importVerifyKey(jwk);
  if (jwk.kty !== 'EC') return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
  const raw = derSignatureToRaw(signature);
  return raw !== null && crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, raw, data);
}

function derSignatureToRaw(der: Uint8Array): Uint8Array<ArrayBuffer> | null {
  if (der[0] !== 0x30 || der[1] !== der.length - 2) return null;
  const raw = new Uint8Array(64);
  let pos = 2;
  for (const target of [0, 32]) {
    const length = der[pos + 1] ?? 0;
    const end = pos + 2 + length;
    if (der[pos] !== 0x02 || length === 0 || end > der.length) return null;
    let integer = der.subarray(pos + 2, end);
    while (integer.length > 32 && integer[0] === 0) integer = integer.subarray(1);
    if (integer.length > 32) return null;
    raw.set(integer, target + 32 - integer.length);
    pos = end;
  }
  return pos === der.length ? raw : null;
}

export type Cbor = number | string | boolean | null | undefined | Uint8Array<ArrayBuffer> | Cbor[] | Map<Cbor, Cbor>;

export function decodeCbor(bytes: Uint8Array<ArrayBuffer>): Cbor {
  const [value, end] = decodeItem(bytes, 0);
  if (end !== bytes.length) throw new Error('cbor: trailing bytes');
  return value;
}

function decodeItem(bytes: Uint8Array<ArrayBuffer>, offset: number): [Cbor, number] {
  const initial = bytes[offset];
  if (initial === undefined) throw new Error('cbor: truncated');
  const major = initial >> 5;
  const info = initial & 0x1f;
  let pos = offset + 1;
  let argument = info;
  if (info >= 24 && info <= 27) {
    const size = 1 << (info - 24);
    if (pos + size > bytes.length) throw new Error('cbor: truncated');
    argument = 0;
    for (let i = 0; i < size; i++) argument = argument * 256 + bytes[pos + i]!;
    pos += size;
  } else if (info > 27) {
    throw new Error('cbor: indefinite length not supported');
  }
  switch (major) {
    case 0:
      return [argument, pos];
    case 1:
      return [-1 - argument, pos];
    case 2:
    case 3: {
      const end = pos + argument;
      if (end > bytes.length) throw new Error('cbor: truncated');
      const slice = bytes.slice(pos, end);
      return [major === 2 ? slice : new TextDecoder().decode(slice), end];
    }
    case 4: {
      const items: Cbor[] = [];
      for (let i = 0; i < argument; i++) {
        const [item, next] = decodeItem(bytes, pos);
        items.push(item);
        pos = next;
      }
      return [items, pos];
    }
    case 5: {
      const map = new Map<Cbor, Cbor>();
      for (let i = 0; i < argument; i++) {
        const [key, afterKey] = decodeItem(bytes, pos);
        const [value, afterValue] = decodeItem(bytes, afterKey);
        map.set(key, value);
        pos = afterValue;
      }
      return [map, pos];
    }
    case 7: {
      const simple = new Map<number, Cbor>([
        [20, false],
        [21, true],
        [22, null],
        [23, undefined],
      ]);
      if (info < 24 && simple.has(info)) return [simple.get(info), pos];
      throw new Error('cbor: unsupported simple value');
    }
    default:
      throw new Error('cbor: unsupported major type');
  }
}
