const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(encoder.encode(value));
}

export function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[0-9a-f]{2})*$/i.test(hex)) throw new Error('invalid hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  let binary = '';
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function base64UrlEncodeText(value: string): string {
  return base64UrlEncode(utf8(value));
}

export function base64UrlDecodeText(value: string): string {
  return decoder.decode(base64UrlDecode(value));
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function randomToken(bytes = 32): string {
  return base64UrlEncode(randomBytes(bytes));
}

export function randomInt(maxExclusive: number): number {
  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    if (buffer[0]! < limit) return buffer[0]! % maxExclusive;
  }
}

export function randomDigits(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String(randomInt(10));
  return out;
}

export async function sha256Hex(value: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const data = typeof value === 'string' ? utf8(value) : value;
  return bytesToHex(await crypto.subtle.digest('SHA-256', data));
}

const hmacKeys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = hmacKeys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    hmacKeys.set(secret, key);
  }
  return key;
}

export async function hmacBytes(secret: string, message: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), utf8(message)));
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  return bytesToHex(await hmacBytes(secret, message));
}

export async function hmacBase64Url(secret: string, message: string): Promise<string> {
  return base64UrlEncode(await hmacBytes(secret, message));
}

export function timingSafeEqual(a: string, b: string): boolean {
  const ab = utf8(a);
  const bb = utf8(b);
  let diff = ab.length ^ bb.length;
  const length = Math.max(ab.length, bb.length);
  for (let i = 0; i < length; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

const aesKeys = new Map<string, Promise<CryptoKey>>();

function aesKey(secret: string): Promise<CryptoKey> {
  let key = aesKeys.get(secret);
  if (!key) {
    key = crypto.subtle
      .digest('SHA-256', utf8(`fete-aes:${secret}`))
      .then((raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']));
    aesKeys.set(secret, key);
  }
  return key;
}

export async function encrypt(secret: string, plaintext: string): Promise<string> {
  const iv = randomBytes(12);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), utf8(plaintext));
  return `${base64UrlEncode(iv)}.${base64UrlEncode(cipher)}`;
}

export async function decrypt(secret: string, payload: string): Promise<string> {
  const [iv, data] = payload.split('.');
  if (!iv || !data) throw new Error('invalid ciphertext');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlDecode(iv) },
    await aesKey(secret),
    base64UrlDecode(data),
  );
  return decoder.decode(plain);
}

export async function signValue(secret: string, purpose: string, payload: unknown): Promise<string> {
  const body = base64UrlEncodeText(JSON.stringify(payload));
  return `${body}.${await hmacBase64Url(secret, `${purpose}:${body}`)}`;
}

export async function verifySignedValue<T>(
  secret: string,
  purpose: string,
  token: string | undefined,
): Promise<T | null> {
  if (!token) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = await hmacBase64Url(secret, `${purpose}:${body}`);
  if (!timingSafeEqual(signature, expected)) return null;
  try {
    return JSON.parse(base64UrlDecodeText(body)) as T;
  } catch {
    return null;
  }
}
