import { decrypt, encrypt } from '../security/crypto.ts';
import type { Env } from '../env.ts';
import { deleteKv, getKv, releaseLock, setKv, tryLock } from './kv.ts';
import { spotifyFailureKind, type SpotifyFailure } from './spotify-api.ts';

export const SPOTIFY_SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-recently-played',
  'playlist-read-private',
  'playlist-read-collaborative',
];

const AUTH_KEY = 'spotify_auth';
const REFRESH_TOKEN_LIFETIME_MS = 182 * 24 * 3_600_000;

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  authorizedAt: number;
  accountName: string | null;
  accountId?: string | null;
}

export type ExchangeResult =
  { ok: true; tokens: SpotifyTokens } | { ok: false; kind: 'exchange_failed' | SpotifyFailure };

const PROFILE_BLOCKERS: ReadonlySet<SpotifyFailure> = new Set([
  'owner_premium_required',
  'user_not_registered',
  'forbidden',
]);

export interface SpotifyAuthStatus {
  configured: boolean;
  connected: boolean;
  accountName: string | null;
  authorizedAt: number | null;
  refreshValidUntil: number | null;
}

export function spotifyConfigured(env: Env): boolean {
  return Boolean(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET);
}

export async function loadTokens(env: Env): Promise<SpotifyTokens | null> {
  const stored = await getKv<string>(env.DB, AUTH_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(await decrypt(env.ENC_KEY, stored.value)) as SpotifyTokens;
  } catch {
    return null;
  }
}

export async function storeTokens(env: Env, tokens: SpotifyTokens, now: number): Promise<void> {
  await setKv(env.DB, AUTH_KEY, await encrypt(env.ENC_KEY, JSON.stringify(tokens)), now);
}

export async function clearTokens(env: Env): Promise<void> {
  await deleteKv(env.DB, AUTH_KEY);
}

export async function authStatus(env: Env): Promise<SpotifyAuthStatus> {
  const tokens = await loadTokens(env);
  return {
    configured: spotifyConfigured(env),
    connected: Boolean(tokens),
    accountName: tokens?.accountName ?? null,
    authorizedAt: tokens?.authorizedAt ?? null,
    refreshValidUntil: tokens ? tokens.authorizedAt + REFRESH_TOKEN_LIFETIME_MS : null,
  };
}

export function authorizeUrl(env: Env, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.SPOTIFY_CLIENT_ID ?? '',
    scope: SPOTIFY_SCOPES.join(' '),
    redirect_uri: redirectUri,
    state,
    show_dialog: 'true',
  });
  return `https://accounts.spotify.com/authorize?${params}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

async function tokenRequest(env: Env, body: URLSearchParams, fetcher: typeof fetch): Promise<TokenResponse | null> {
  try {
    const response = await fetcher('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      console.warn(`spotify token request failed: ${response.status}`);
      return null;
    }
    return (await response.json()) as TokenResponse;
  } catch {
    console.warn('spotify token request failed: network');
    return null;
  }
}

async function fetchProfile(
  accessToken: string,
  fetcher: typeof fetch,
): Promise<{ ok: true; id: string | null; name: string | null } | { ok: false; kind: SpotifyFailure }> {
  try {
    const response = await fetcher('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { ok: false, kind: spotifyFailureKind(response.status, await response.text()) };
    const profile = (await response.json()) as { display_name?: string; id?: string };
    return { ok: true, id: profile.id ?? null, name: profile.display_name ?? null };
  } catch {
    return { ok: false, kind: 'unknown' };
  }
}

export async function exchangeCode(
  env: Env,
  code: string,
  redirectUri: string,
  now: number,
  fetcher: typeof fetch = fetch,
): Promise<ExchangeResult> {
  const result = await tokenRequest(
    env,
    new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    fetcher,
  );
  if (!result?.access_token || !result.refresh_token) return { ok: false, kind: 'exchange_failed' };
  const profile = await fetchProfile(result.access_token, fetcher);
  if (!profile.ok && PROFILE_BLOCKERS.has(profile.kind)) return { ok: false, kind: profile.kind };
  const tokens: SpotifyTokens = {
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    expiresAt: now + (result.expires_in ?? 3600) * 1000,
    authorizedAt: now,
    accountName: profile.ok ? profile.name : null,
    accountId: profile.ok ? profile.id : null,
  };
  await storeTokens(env, tokens, now);
  return { ok: true, tokens };
}

export async function rememberAccountId(env: Env, accountId: string, now: number): Promise<void> {
  const tokens = await loadTokens(env);
  if (tokens) await storeTokens(env, { ...tokens, accountId }, now);
}

export async function validAccessToken(env: Env, now: number, fetcher: typeof fetch = fetch): Promise<string | null> {
  const tokens = await loadTokens(env);
  if (!tokens) return null;
  if (tokens.expiresAt - 60_000 > now) return tokens.accessToken;
  if (!(await tryLock(env.DB, 'spotify_refresh', now, 15_000))) {
    return tokens.expiresAt > now ? tokens.accessToken : null;
  }
  try {
    const result = await tokenRequest(
      env,
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }),
      fetcher,
    );
    if (!result?.access_token) return tokens.expiresAt > now ? tokens.accessToken : null;
    const refreshed: SpotifyTokens = {
      ...tokens,
      accessToken: result.access_token,
      refreshToken: result.refresh_token ?? tokens.refreshToken,
      expiresAt: now + (result.expires_in ?? 3600) * 1000,
    };
    await storeTokens(env, refreshed, now);
    return refreshed.accessToken;
  } finally {
    await releaseLock(env.DB, 'spotify_refresh');
  }
}
