import { base64UrlDecode, base64UrlEncode, utf8 } from '../../src/server/security/crypto.ts';

export type CborInput = number | string | Uint8Array | CborInput[] | Map<CborInput, CborInput>;

export function encodeCbor(value: CborInput): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  const head = (major: number, length: number) => {
    if (length < 24) out.push((major << 5) | length);
    else if (length < 0x100) out.push((major << 5) | 24, length);
    else if (length < 0x10000) out.push((major << 5) | 25, length >> 8, length & 0xff);
    else
      out.push((major << 5) | 26, (length >>> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff);
  };
  const write = (item: CborInput) => {
    if (typeof item === 'number') head(item < 0 ? 1 : 0, item < 0 ? -1 - item : item);
    else if (typeof item === 'string') {
      const bytes = utf8(item);
      head(3, bytes.length);
      out.push(...bytes);
    } else if (item instanceof Uint8Array) {
      head(2, item.length);
      out.push(...item);
    } else if (Array.isArray(item)) {
      head(4, item.length);
      item.forEach(write);
    } else {
      head(5, item.size);
      for (const [k, v] of item) {
        write(k);
        write(v);
      }
    }
  };
  write(value);
  return new Uint8Array(out);
}

function rawToDer(raw: Uint8Array): Uint8Array {
  const integer = (part: Uint8Array) => {
    let start = 0;
    while (start < part.length - 1 && part[start] === 0) start++;
    const trimmed = part.subarray(start);
    const body = trimmed[0]! & 0x80 ? [0, ...trimmed] : [...trimmed];
    return [0x02, body.length, ...body];
  };
  const content = [...integer(raw.subarray(0, 32)), ...integer(raw.subarray(32))];
  return new Uint8Array([0x30, content.length, ...content]);
}

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

interface StoredCredential {
  id: Uint8Array<ArrayBuffer>;
  rpId: string;
  userHandle: string;
  keys: CryptoKeyPair;
  signCount: number;
}

interface CreationOptions {
  challenge: string;
  rp: { id: string };
  user: { id: string };
}

interface RequestOptions {
  challenge: string;
  rpId: string;
  allowCredentials: Array<{ id: string }>;
}

export class SoftwareAuthenticator {
  readonly credentials: StoredCredential[] = [];

  constructor(
    private readonly origin: string,
    private readonly flags = 0x05,
    private readonly countSignatures = false,
  ) {}

  async create(options: CreationOptions, origin = this.origin) {
    const keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
    const id = crypto.getRandomValues(new Uint8Array(32));
    const credential = { id, rpId: options.rp.id, userHandle: options.user.id, keys, signCount: 0 };
    this.credentials.push(credential);
    const cose = encodeCbor(
      new Map<CborInput, CborInput>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, base64UrlDecode(jwk.x!)],
        [-3, base64UrlDecode(jwk.y!)],
      ]),
    );
    const authData = concat(
      await sha256(utf8(options.rp.id)),
      new Uint8Array([this.flags | 0x40, 0, 0, 0, 0]),
      new Uint8Array(16),
      new Uint8Array([0, id.length]),
      id,
      cose,
    );
    const clientDataJSON = utf8(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin }));
    return {
      id: base64UrlEncode(id),
      type: 'public-key' as const,
      response: {
        clientDataJSON: base64UrlEncode(clientDataJSON),
        attestationObject: base64UrlEncode(
          encodeCbor(
            new Map<CborInput, CborInput>([
              ['fmt', 'none'],
              ['attStmt', new Map()],
              ['authData', authData],
            ]),
          ),
        ),
        transports: ['internal'],
      },
    };
  }

  async get(options: RequestOptions, origin = this.origin, credential = this.pick(options)) {
    if (this.countSignatures) credential.signCount++;
    const count = credential.signCount;
    const authData = concat(
      await sha256(utf8(options.rpId)),
      new Uint8Array([this.flags, (count >>> 24) & 0xff, (count >> 16) & 0xff, (count >> 8) & 0xff, count & 0xff]),
    );
    const clientDataJSON = utf8(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin }));
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        credential.keys.privateKey,
        concat(authData, await sha256(clientDataJSON)),
      ),
    );
    return {
      id: base64UrlEncode(credential.id),
      type: 'public-key' as const,
      response: {
        clientDataJSON: base64UrlEncode(clientDataJSON),
        authenticatorData: base64UrlEncode(authData),
        signature: base64UrlEncode(rawToDer(signature)),
        userHandle: credential.userHandle,
      },
    };
  }

  private pick(options: RequestOptions): StoredCredential {
    const allowed = new Set(options.allowCredentials.map((c) => c.id));
    const match = [...this.credentials]
      .reverse()
      .find((c) => c.rpId === options.rpId && (!allowed.size || allowed.has(base64UrlEncode(c.id))));
    if (!match) throw new Error('no matching credential');
    return match;
  }
}
