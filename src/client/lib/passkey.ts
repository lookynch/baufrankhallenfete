import { api, ApiError } from './api.ts';

interface CredentialDescriptorJson {
  type: 'public-key';
  id: string;
  transports: AuthenticatorTransport[];
}

interface CreationOptionsJson {
  challenge: string;
  rp: PublicKeyCredentialRpEntity;
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: PublicKeyCredentialParameters[];
  timeout: number;
  attestation: AttestationConveyancePreference;
  authenticatorSelection: AuthenticatorSelectionCriteria;
  excludeCredentials: CredentialDescriptorJson[];
}

interface RequestOptionsJson {
  challenge: string;
  rpId: string;
  timeout: number;
  userVerification: UserVerificationRequirement;
  allowCredentials: CredentialDescriptorJson[];
}

export function passkeysSupported(): boolean {
  return typeof window.PublicKeyCredential === 'function' && typeof navigator.credentials?.create === 'function';
}

function toBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toBase64Url(buffer: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function descriptors(list: CredentialDescriptorJson[]): PublicKeyCredentialDescriptor[] {
  return list.map((c) => ({ ...c, id: toBytes(c.id) }));
}

async function browserCeremony<T extends Credential>(ceremony: () => Promise<Credential | null>): Promise<T | null> {
  try {
    return (await ceremony()) as T | null;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') return null;
    if (error instanceof DOMException && error.name === 'InvalidStateError') throw new ApiError(0, 'passkey_exists');
    throw new ApiError(0, 'passkey_failed');
  }
}

export async function createPasskey(optionsPath: string, completePath: string, extra: object = {}) {
  const options = await api.post<CreationOptionsJson>(optionsPath, extra);
  const credential = await browserCeremony<PublicKeyCredential>(() =>
    navigator.credentials.create({
      publicKey: {
        ...options,
        challenge: toBytes(options.challenge),
        user: { ...options.user, id: toBytes(options.user.id) },
        excludeCredentials: descriptors(options.excludeCredentials),
      },
    }),
  );
  if (!credential) return false;
  const response = credential.response as AuthenticatorAttestationResponse;
  await api.post(completePath, {
    ...extra,
    credential: {
      id: credential.id,
      type: 'public-key',
      response: {
        clientDataJSON: toBase64Url(response.clientDataJSON),
        attestationObject: toBase64Url(response.attestationObject),
        transports: response.getTransports?.() ?? [],
      },
    },
  });
  return true;
}

export async function signInWithPasskey(optionsPath: string, verifyPath: string) {
  const options = await api.post<RequestOptionsJson>(optionsPath);
  const credential = await browserCeremony<PublicKeyCredential>(() =>
    navigator.credentials.get({
      publicKey: {
        ...options,
        challenge: toBytes(options.challenge),
        allowCredentials: descriptors(options.allowCredentials),
      },
    }),
  );
  if (!credential) return false;
  const response = credential.response as AuthenticatorAssertionResponse;
  await api.post(verifyPath, {
    credential: {
      id: credential.id,
      type: 'public-key',
      response: {
        clientDataJSON: toBase64Url(response.clientDataJSON),
        authenticatorData: toBase64Url(response.authenticatorData),
        signature: toBase64Url(response.signature),
        userHandle: response.userHandle ? toBase64Url(response.userHandle) : null,
      },
    },
  });
  return true;
}
