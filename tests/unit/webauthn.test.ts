import { describe, expect, it } from 'vitest';
import { base64UrlDecode, base64UrlEncode, utf8 } from '../../src/server/security/crypto.ts';
import {
  decodeCbor,
  parseClientData,
  relyingParty,
  verifyAuthentication,
  verifyRegistration,
} from '../../src/server/security/webauthn.ts';
import { encodeCbor, SoftwareAuthenticator, type CborInput } from '../helpers/authenticator.ts';

const ORIGIN = 'https://fete.example';
const rp = relyingParty(ORIGIN, 'Fete')!;

async function registered(authenticator = new SoftwareAuthenticator(ORIGIN)) {
  const credential = await authenticator.create({ challenge: 'c1', rp: { id: rp.id }, user: { id: 'dXNlcg' } });
  const passkey = await verifyRegistration(rp, credential, parseClientData(credential.response.clientDataJSON)!);
  return { authenticator, credential, passkey: passkey! };
}

async function assertion(authenticator: SoftwareAuthenticator) {
  const credential = await authenticator.get({ challenge: 'c2', rpId: rp.id, allowCredentials: [] });
  return { credential, clientData: parseClientData(credential.response.clientDataJSON)! };
}

describe('WebAuthn-Prüfung', () => {
  it('leitet die Relying Party aus der Origin ab', () => {
    expect(relyingParty('http://localhost:8799/admin', 'Fete')).toEqual({
      id: 'localhost',
      origin: 'http://localhost:8799',
      name: 'Fete',
    });
    expect(relyingParty(undefined, 'Fete')).toBeNull();
    expect(relyingParty('kein url', 'Fete')).toBeNull();
  });

  it('registriert ES256-Passkeys und prüft deren Signaturen', async () => {
    const { authenticator, passkey } = await registered();
    expect(passkey.transports).toEqual(['internal']);
    const { credential, clientData } = await assertion(authenticator);
    expect(await verifyAuthentication(rp, credential, clientData, { ...passkey })).toEqual({ signCount: 0 });

    const signature = base64UrlDecode(credential.response.signature);
    signature[signature.length - 1]! ^= 0x01;
    const tampered = { ...credential, response: { ...credential.response, signature: base64UrlEncode(signature) } };
    expect(await verifyAuthentication(rp, tampered, clientData, { ...passkey })).toBeNull();

    const garbage = { ...credential, response: { ...credential.response, signature: base64UrlEncode(utf8('x')) } };
    expect(await verifyAuthentication(rp, garbage, clientData, { ...passkey })).toBeNull();
  });

  it('lehnt falsche RP-ID, Typ und abweichende Credential-ID ab', async () => {
    const { authenticator, credential, passkey } = await registered();
    const clientData = parseClientData(credential.response.clientDataJSON)!;
    const otherRp = relyingParty('https://andere.example', 'Fete')!;
    expect(await verifyRegistration({ ...otherRp, origin: ORIGIN }, credential, clientData)).toBeNull();
    expect(await verifyRegistration(rp, credential, { ...clientData, type: 'webauthn.get' })).toBeNull();
    expect(await verifyRegistration(rp, { ...credential, id: 'AAAAAAAAAAAAAAAAAAAAAA' }, clientData)).toBeNull();
    expect(await verifyRegistration(rp, credential, { ...clientData, crossOrigin: true })).toBeNull();

    const login = await assertion(authenticator);
    expect(
      await verifyAuthentication(rp, login.credential, { ...login.clientData, type: 'webauthn.create' }, passkey),
    ).toBeNull();
  });

  it('prüft RS256-Schlüssel', async () => {
    const keys = (await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
    const id = new Uint8Array(16).fill(7);
    const rpIdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(rp.id)));
    const cose = encodeCbor(
      new Map<CborInput, CborInput>([
        [1, 3],
        [3, -257],
        [-1, base64UrlDecode(jwk.n!)],
        [-2, base64UrlDecode(jwk.e!)],
      ]),
    );
    const authData = new Uint8Array([
      ...rpIdHash,
      0x45,
      0,
      0,
      0,
      0,
      ...new Uint8Array(16),
      0,
      id.length,
      ...id,
      ...cose,
    ]);
    const clientDataJSON = base64UrlEncode(
      utf8(JSON.stringify({ type: 'webauthn.create', challenge: 'c', origin: ORIGIN })),
    );
    const attestationObject = base64UrlEncode(
      encodeCbor(
        new Map<CborInput, CborInput>([
          ['fmt', 'none'],
          ['authData', authData],
        ]),
      ),
    );
    const registration = {
      id: base64UrlEncode(id),
      type: 'public-key' as const,
      response: { clientDataJSON, attestationObject },
    };
    const passkey = await verifyRegistration(rp, registration, parseClientData(clientDataJSON)!);
    expect(JSON.parse(passkey!.publicKey)).toMatchObject({ kty: 'RSA', alg: 'RS256' });

    const getData = utf8(JSON.stringify({ type: 'webauthn.get', challenge: 'c', origin: ORIGIN }));
    const assertionData = new Uint8Array([...rpIdHash, 0x05, 0, 0, 0, 1]);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', getData));
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      keys.privateKey,
      new Uint8Array([...assertionData, ...hash]),
    );
    const result = await verifyAuthentication(
      rp,
      {
        id: registration.id,
        type: 'public-key',
        response: {
          clientDataJSON: base64UrlEncode(getData),
          authenticatorData: base64UrlEncode(assertionData),
          signature: base64UrlEncode(signature),
        },
      },
      parseClientData(base64UrlEncode(getData))!,
      { publicKey: passkey!.publicKey, signCount: 0 },
    );
    expect(result).toEqual({ signCount: 1 });
  });

  it('dekodiert nur gültiges CBOR', () => {
    expect(decodeCbor(encodeCbor([1, -2, 'ä', new Uint8Array([9]), new Map([[1, 300]])]))).toEqual([
      1,
      -2,
      'ä',
      new Uint8Array([9]),
      new Map([[1, 300]]),
    ]);
    expect(decodeCbor(new Uint8Array([0xf4]))).toBe(false);
    expect(decodeCbor(new Uint8Array([0xf6]))).toBeNull();
    expect(() => decodeCbor(new Uint8Array([0x5f]))).toThrow();
    expect(() => decodeCbor(new Uint8Array([0x42, 1]))).toThrow();
    expect(() => decodeCbor(new Uint8Array([0x01, 0x01]))).toThrow();
    expect(() => decodeCbor(new Uint8Array([0xc1, 0x00]))).toThrow();
    expect(() => decodeCbor(new Uint8Array([0xf9, 0, 0]))).toThrow();
    expect(parseClientData(base64UrlEncode(utf8('{"type":1}')))).toBeNull();
    expect(parseClientData('!!')).toBeNull();
  });
});
