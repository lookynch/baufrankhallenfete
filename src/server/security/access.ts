import { base64UrlDecode, base64UrlDecodeText, utf8 } from './crypto.ts';

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
}

const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();

async function loadKeys(teamDomain: string, now: number, fetcher: typeof fetch): Promise<Jwk[]> {
  const cached = jwksCache.get(teamDomain);
  if (cached && now - cached.fetchedAt < 3_600_000) return cached.keys;
  const response = await fetcher(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error('access certs unavailable');
  const { keys } = (await response.json()) as { keys: Jwk[] };
  jwksCache.set(teamDomain, { keys, fetchedAt: now });
  return keys;
}

export async function verifyAccessJwt(
  token: string | null | undefined,
  teamDomain: string,
  audience: string,
  now: number,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (!token) return false;
  const [headerPart, payloadPart, signaturePart] = token.split('.');
  if (!headerPart || !payloadPart || !signaturePart) return false;
  try {
    const header = JSON.parse(base64UrlDecodeText(headerPart)) as { kid?: string; alg?: string };
    const payload = JSON.parse(base64UrlDecodeText(payloadPart)) as { aud?: string | string[]; exp?: number; iss?: string };
    if (header.alg !== 'RS256') return false;
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(audience)) return false;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < now) return false;
    if (payload.iss !== `https://${teamDomain}`) return false;
    const jwk = (await loadKeys(teamDomain, now, fetcher)).find((k) => k.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64UrlDecode(signaturePart),
      utf8(`${headerPart}.${payloadPart}`),
    );
  } catch {
    return false;
  }
}
