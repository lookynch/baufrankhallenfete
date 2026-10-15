import type { SpotifyApi } from './services/spotify-api.ts';

export interface Env {
  DB: D1Database;
  SESSION_PEPPER: string;
  COOKIE_SECRET: string;
  QR_SECRET: string;
  IP_HASH_SECRET: string;
  BUZZER_HMAC_SECRET: string;
  ENC_KEY: string;
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  BOOTSTRAP_TOKEN?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  CF_ANALYTICS_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  PBKDF2_ITERATIONS?: string;
}

export interface Runtime {
  env: Env;
  now: () => number;
  waitUntil: (promise: Promise<unknown>) => void;
  spotify: SpotifyApi;
}

export const requiredSecrets = [
  'SESSION_PEPPER',
  'COOKIE_SECRET',
  'QR_SECRET',
  'IP_HASH_SECRET',
  'BUZZER_HMAC_SECRET',
  'ENC_KEY',
] as const satisfies ReadonlyArray<keyof Env>;
