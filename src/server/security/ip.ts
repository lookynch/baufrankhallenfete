import { hmacHex } from './crypto.ts';

export type IpFamily = 'v4' | 'v6' | 'unknown';

export interface NormalizedIp {
  family: IpFamily;
  key: string;
}

function expandIpv6(address: string): number[] | null {
  const [head, tail, extra] = address.split('::');
  if (extra !== undefined) return null;
  const parse = (part: string | undefined) => (part ? part.split(':') : []);
  const headParts = parse(head);
  const tailParts = parse(tail);
  const missing = 8 - headParts.length - tailParts.length;
  if (tail === undefined ? missing !== 0 : missing < 1) return null;
  const groups = [...headParts, ...Array<string>(tail === undefined ? 0 : missing).fill('0'), ...tailParts];
  if (groups.length !== 8) return null;
  const values = groups.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  return values.some(Number.isNaN) ? null : values;
}

function isIpv4(address: string): boolean {
  const parts = address.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

function cleanAddress(raw: string | null | undefined): string {
  return (
    (raw ?? '')
      .trim()
      .replace(/^\[|\]$/g, '')
      .split('%')[0] ?? ''
  );
}

function v6Prefix(groups: number[], count: number): string {
  return `v6:${groups
    .slice(0, count)
    .map((g) => g.toString(16))
    .join(':')}::/${count * 16}`;
}

export function normalizeIp(raw: string | null | undefined): NormalizedIp {
  const address = cleanAddress(raw);
  if (isIpv4(address)) return { family: 'v4', key: `v4:${address}` };
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped?.[1] && isIpv4(mapped[1])) return { family: 'v4', key: `v4:${mapped[1]}` };
  const groups = expandIpv6(address);
  if (groups) return { family: 'v6', key: v6Prefix(groups, 4) };
  return { family: 'unknown', key: 'unknown' };
}

export function networkKey(raw: string | null | undefined): string {
  const normalized = normalizeIp(raw);
  const groups = normalized.family === 'v6' ? expandIpv6(cleanAddress(raw)) : null;
  return groups ? v6Prefix(groups, 3) : normalized.key;
}

export async function ipKeyHash(
  secret: string,
  raw: string | null | undefined,
): Promise<{ family: IpFamily; hash: string; netHash: string }> {
  const { family, key } = normalizeIp(raw);
  const net = networkKey(raw);
  const hash = (await hmacHex(secret, `ip:${key}`)).slice(0, 32);
  return { family, hash, netHash: net === key ? hash : (await hmacHex(secret, `ip:${net}`)).slice(0, 32) };
}
