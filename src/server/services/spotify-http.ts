import type { Env } from '../env.ts';
import { getKv, setKv } from './kv.ts';
import { validAccessToken } from './spotify-auth.ts';
import {
  mapTrack,
  spotifyErrorReason,
  spotifyFailureKind,
  type PlaybackSnapshot,
  type PlayerInfo,
  type PlaylistSummary,
  type SpotifyApi,
  type SpotifyFailure,
  type SpotifyResult,
  type SpotifyTrack,
} from './spotify-api.ts';

const API = 'https://api.spotify.com/v1';
const BACKOFF_KEY = 'spotify_backoff_until';
export const LAST_ERROR_KEY = 'spotify_last_error';
const LOG_INTERVAL_MS = 60_000;
let backoffUntilMemo = 0;
const lastLogged = new Map<string, number>();

type Json = Record<string, unknown>;

function failure<T>(kind: SpotifyFailure, status?: number, message?: string): SpotifyResult<T> {
  return { ok: false, kind, status, message };
}

export function pathTemplate(path: string): string {
  return path.split('?')[0]!.replace(/\/[A-Za-z0-9]{16,}(?=\/|$)/g, '/:id');
}

export interface SpotifyLastError {
  at: number;
  method: string;
  path: string;
  status: number;
  kind: SpotifyFailure;
  reason: string | null;
  message: string | null;
}

function errorMessage(body: string): string | null {
  try {
    const message = (JSON.parse(body) as { error?: { message?: unknown } }).error?.message;
    return typeof message === 'string' ? message.slice(0, 200) : null;
  } catch {
    return body ? body.slice(0, 200) : null;
  }
}

async function logFailure(
  db: D1Database,
  method: string,
  path: string,
  status: number,
  kind: SpotifyFailure,
  body: string,
  time: number,
) {
  const key = `${method} ${pathTemplate(path)} ${status}`;
  if ((lastLogged.get(key) ?? 0) + LOG_INTERVAL_MS > time) return;
  lastLogged.set(key, time);
  const reason = spotifyErrorReason(body);
  console.warn(`spotify ${key} ${kind} reason=${reason ?? '-'}`);
  const entry: SpotifyLastError = {
    at: time,
    method,
    path: pathTemplate(path),
    status,
    kind,
    reason,
    message: errorMessage(body),
  };
  await setKv(db, LAST_ERROR_KEY, entry, time);
}

export function createHttpSpotify(env: Env, now: () => number, fetcher: typeof fetch = fetch): SpotifyApi {
  async function call(
    method: string,
    path: string,
    options: { body?: unknown; expectJson?: boolean } = {},
  ): Promise<SpotifyResult<Json | null>> {
    const time = now();
    if (backoffUntilMemo > time) return failure('rate_limited');
    const backoff = await getKv<number>(env.DB, BACKOFF_KEY);
    if (backoff && backoff.value > time) {
      backoffUntilMemo = backoff.value;
      return failure('rate_limited');
    }
    const token = await validAccessToken(env, time, fetcher);
    if (!token) {
      await logFailure(
        env.DB,
        method,
        path,
        0,
        'not_connected',
        'Zugangstoken fehlt oder Erneuerung fehlgeschlagen',
        time,
      );
      return failure('not_connected');
    }
    let response: Response;
    try {
      response = await fetcher(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(6_000),
      });
    } catch {
      await logFailure(env.DB, method, path, 0, 'unknown', 'Keine Antwort (Timeout oder Netzwerk)', time);
      return failure('unknown');
    }
    if (response.status === 429) {
      const retryAfter = Math.min(Number(response.headers.get('Retry-After') ?? '5') || 5, 600);
      backoffUntilMemo = time + retryAfter * 1000;
      await setKv(env.DB, BACKOFF_KEY, backoffUntilMemo, time);
      return failure('rate_limited', 429);
    }
    if (response.status === 204 || response.status === 202) return { ok: true, value: null };
    if (response.ok) {
      const text = await response.text();
      if (!text || options.expectJson === false) return { ok: true, value: null };
      try {
        return { ok: true, value: JSON.parse(text) as Json };
      } catch {
        return { ok: true, value: null };
      }
    }
    const message = await response.text().catch(() => '');
    const kind = spotifyFailureKind(response.status, message);
    await logFailure(env.DB, method, path, response.status, kind, message, time);
    return failure(kind, response.status, message.slice(0, 300));
  }

  function mapResult<T>(result: SpotifyResult<Json | null>, map: (json: Json | null) => T): SpotifyResult<T> {
    return result.ok ? { ok: true, value: map(result.value) } : result;
  }

  const tracksFrom = (items: unknown): SpotifyTrack[] =>
    (Array.isArray(items) ? items : [])
      .map((i) => mapTrack(i as Parameters<typeof mapTrack>[0]))
      .filter((t): t is SpotifyTrack => t !== null);

  return {
    async currentlyPlaying() {
      const result = await call('GET', '/me/player/currently-playing?additional_types=track');
      return mapResult(result, (json): PlaybackSnapshot => {
        if (!json) return { isPlaying: false, progressMs: 0, track: null, contextUri: null };
        return {
          isPlaying: json.is_playing === true,
          progressMs: typeof json.progress_ms === 'number' ? json.progress_ms : 0,
          track: mapTrack(json.item as Parameters<typeof mapTrack>[0]),
          contextUri: ((json.context as Json | null)?.uri as string | undefined) ?? null,
        };
      });
    },
    async addToQueue(uri) {
      return mapResult(
        await call('POST', `/me/player/queue?uri=${encodeURIComponent(uri)}`, { expectJson: false }),
        () => null,
      );
    },
    async skipNext() {
      return mapResult(await call('POST', '/me/player/next', { expectJson: false }), () => null);
    },
    async setRepeatContext() {
      return mapResult(await call('PUT', '/me/player/repeat?state=context', { expectJson: false }), () => null);
    },
    async startContext(contextUri) {
      return mapResult(
        await call('PUT', '/me/player/play', { body: { context_uri: contextUri }, expectJson: false }),
        () => null,
      );
    },
    async player() {
      return mapResult(await call('GET', '/me/player'), (json): PlayerInfo => {
        const device = (json?.device as Json | undefined) ?? null;
        return {
          deviceName: (device?.name as string | undefined) ?? null,
          deviceActive: device?.is_active === true,
          repeatState: (json?.repeat_state as string | undefined) ?? null,
          shuffle: json?.shuffle_state === true,
        };
      });
    },
    async recentlyPlayed() {
      return mapResult(await call('GET', '/me/player/recently-played?limit=50'), (json) =>
        (Array.isArray(json?.items) ? (json.items as Json[]) : [])
          .map((i) => ({
            track: mapTrack(i.track as Parameters<typeof mapTrack>[0]),
            playedAt: Date.parse(String(i.played_at)),
          }))
          .filter(
            (i): i is { track: SpotifyTrack; playedAt: number } => i.track !== null && Number.isFinite(i.playedAt),
          ),
      );
    },
    async search(query) {
      const params = new URLSearchParams({ q: query, type: 'track', limit: '10' });
      return mapResult(await call('GET', `/search?${params}`), (json) =>
        tracksFrom((json?.tracks as Json | undefined)?.items),
      );
    },
    async track(id) {
      const result = await call('GET', `/tracks/${encodeURIComponent(id)}`);
      if (!result.ok) return result;
      const track = mapTrack(result.value as Parameters<typeof mapTrack>[0]);
      return track ? { ok: true, value: track } : failure('not_found');
    },
    async playlistPage(id, offset) {
      const params = new URLSearchParams({ limit: '50', offset: String(offset) });
      const result = await call('GET', `/playlists/${encodeURIComponent(id)}/items?${params}`);
      if (!result.ok) return result;
      const json = result.value;
      if (!Array.isArray(json?.items)) return failure('forbidden');
      const items = json.items as Json[];
      const tracks = items
        .map((i) => mapTrack((i.item ?? i.track) as Parameters<typeof mapTrack>[0]))
        .filter((t): t is SpotifyTrack => t !== null);
      const total = typeof json.total === 'number' ? json.total : tracks.length;
      const nextOffset = offset + items.length;
      const next = json.next && items.length > 0 && nextOffset < total ? nextOffset : null;
      return { ok: true, value: { tracks, total, next } };
    },
    async myPlaylists() {
      return mapResult(await call('GET', '/me/playlists?limit=50'), (json) =>
        (Array.isArray(json?.items) ? (json.items as Json[]) : []).map((p): PlaylistSummary => ({
          uri: String(p.uri),
          id: String(p.id),
          name: String(p.name ?? ''),
          trackCount: Number(((p.items ?? p.tracks) as Json | undefined)?.total ?? 0),
          owner: String((p.owner as Json | undefined)?.display_name ?? ''),
          ownerId: String((p.owner as Json | undefined)?.id ?? ''),
          collaborative: p.collaborative === true,
        })),
      );
    },
    async me() {
      return mapResult(await call('GET', '/me'), (json) => ({
        id: String(json?.id ?? ''),
        name: typeof json?.display_name === 'string' ? json.display_name : null,
      }));
    },
  };
}
