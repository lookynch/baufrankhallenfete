import type { Env, Runtime } from '../../src/server/env.ts';
import type { Lastfm } from '../../src/server/services/genres.ts';
import type { SpotifyApi } from '../../src/server/services/spotify-api.ts';
import { createTestDb } from './d1.ts';

export const testSecrets = {
  SESSION_PEPPER: 'test-pepper-0123456789',
  COOKIE_SECRET: 'test-cookie-secret-0123456789',
  QR_SECRET: 'test-qr-secret-0123456789',
  IP_HASH_SECRET: 'test-ip-secret-0123456789',
  BUZZER_HMAC_SECRET: 'test-buzzer-secret-0123456789',
  ENC_KEY: 'test-enc-key-0123456789',
  PBKDF2_ITERATIONS: '10000',
};

export function testEnv(overrides: Partial<Env> = {}): Env {
  return { DB: createTestDb(), ...testSecrets, ...overrides };
}

export class Clock {
  constructor(public time: number) {}
  now = () => this.time;
  advance(ms: number) {
    this.time += ms;
  }
}

export function testRuntime(
  env: Env,
  clock: Clock,
  spotify: SpotifyApi,
  lastfm: Lastfm | null = null,
): Runtime & { settle: () => Promise<void> } {
  const pending: Promise<unknown>[] = [];
  return {
    env,
    now: clock.now,
    spotify,
    lastfm,
    waitUntil: (p) => {
      pending.push(p);
    },
    settle: async () => {
      while (pending.length) await pending.shift();
    },
  };
}
