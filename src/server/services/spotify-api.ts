export interface SpotifyTrack {
  uri: string;
  title: string;
  artist: string;
  album: string | null;
  imageUrl: string | null;
  durationMs: number;
  explicit: boolean;
  isrc: string | null;
}

export interface PlaybackSnapshot {
  isPlaying: boolean;
  progressMs: number;
  track: SpotifyTrack | null;
  contextUri: string | null;
}

export interface PlayerInfo {
  deviceName: string | null;
  deviceActive: boolean;
  repeatState: string | null;
  shuffle: boolean;
}

export interface PlaylistSummary {
  uri: string;
  id: string;
  name: string;
  trackCount: number;
  owner: string;
}

export type SpotifyFailure =
  'not_connected' | 'no_device' | 'rate_limited' | 'unauthorized' | 'not_found' | 'client_error' | 'unknown';

export type SpotifyResult<T> =
  { ok: true; value: T } | { ok: false; kind: SpotifyFailure; status?: number; message?: string };

export interface SpotifyApi {
  currentlyPlaying(): Promise<SpotifyResult<PlaybackSnapshot>>;
  addToQueue(uri: string): Promise<SpotifyResult<null>>;
  skipNext(): Promise<SpotifyResult<null>>;
  setRepeatContext(): Promise<SpotifyResult<null>>;
  startContext(contextUri: string): Promise<SpotifyResult<null>>;
  player(): Promise<SpotifyResult<PlayerInfo>>;
  recentlyPlayed(): Promise<SpotifyResult<Array<{ track: SpotifyTrack; playedAt: number }>>>;
  search(query: string): Promise<SpotifyResult<SpotifyTrack[]>>;
  track(id: string): Promise<SpotifyResult<SpotifyTrack>>;
  playlistPage(
    id: string,
    offset: number,
  ): Promise<SpotifyResult<{ tracks: SpotifyTrack[]; next: number | null; total: number }>>;
  myPlaylists(): Promise<SpotifyResult<PlaylistSummary[]>>;
}

interface RawTrack {
  uri?: string;
  type?: string;
  name?: string;
  duration_ms?: number;
  explicit?: boolean;
  is_local?: boolean;
  artists?: Array<{ name?: string }>;
  album?: { name?: string; images?: Array<{ url?: string; width?: number | null }> };
  external_ids?: { isrc?: string };
}

export function mapTrack(raw: RawTrack | null | undefined): SpotifyTrack | null {
  if (!raw?.uri || !raw.uri.startsWith('spotify:track:') || raw.is_local || !raw.name || !raw.duration_ms) return null;
  const images = [...(raw.album?.images ?? [])].filter((i) => i.url).sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  const image = images.find((i) => (i.width ?? 0) >= 250) ?? images[images.length - 1];
  return {
    uri: raw.uri,
    title: raw.name,
    artist: (raw.artists ?? [])
      .map((a) => a.name)
      .filter(Boolean)
      .join(', '),
    album: raw.album?.name ?? null,
    imageUrl: image?.url ?? null,
    durationMs: raw.duration_ms,
    explicit: raw.explicit === true,
    isrc: raw.external_ids?.isrc?.toUpperCase() ?? null,
  };
}

export function parseSpotifyReference(input: string): { kind: 'track' | 'playlist'; id: string } | null {
  const trimmed = input.trim();
  const uri = /^spotify:(track|playlist):([A-Za-z0-9]{10,40})$/.exec(trimmed);
  if (uri) return { kind: uri[1] as 'track' | 'playlist', id: uri[2]! };
  try {
    const url = new URL(trimmed);
    if (url.hostname !== 'open.spotify.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const index = parts.findIndex((p) => p === 'track' || p === 'playlist');
    const id = parts[index + 1];
    if (index < 0 || !id || !/^[A-Za-z0-9]{10,40}$/.test(id)) return null;
    return { kind: parts[index] as 'track' | 'playlist', id };
  } catch {
    return null;
  }
}

export const disconnectedSpotify: SpotifyApi = {
  currentlyPlaying: async () => ({ ok: false, kind: 'not_connected' }),
  addToQueue: async () => ({ ok: false, kind: 'not_connected' }),
  skipNext: async () => ({ ok: false, kind: 'not_connected' }),
  setRepeatContext: async () => ({ ok: false, kind: 'not_connected' }),
  startContext: async () => ({ ok: false, kind: 'not_connected' }),
  player: async () => ({ ok: false, kind: 'not_connected' }),
  recentlyPlayed: async () => ({ ok: false, kind: 'not_connected' }),
  search: async () => ({ ok: false, kind: 'not_connected' }),
  track: async () => ({ ok: false, kind: 'not_connected' }),
  playlistPage: async () => ({ ok: false, kind: 'not_connected' }),
  myPlaylists: async () => ({ ok: false, kind: 'not_connected' }),
};
