import type {
  PlaylistSummary,
  SpotifyApi,
  SpotifyFailure,
  SpotifyResult,
  SpotifyTrack,
} from '../../src/server/services/spotify-api.ts';

export interface PlayLogEntry {
  uri: string;
  startedAt: number;
  source: 'queue' | 'context';
}

export class FakeSpotify implements SpotifyApi {
  readonly catalog = new Map<string, SpotifyTrack>();
  readonly queue: string[] = [];
  readonly log: PlayLogEntry[] = [];
  context: string[] = [];
  contextIndex = 0;
  current: { uri: string; startedAt: number; pausedAt: number | null } | null = null;
  failQueue: SpotifyResult<null> | null = null;
  maxQueueLength = 0;
  offline = false;
  playlists: PlaylistSummary[] = [];
  account: { id: string; name: string | null } = { id: 'party', name: 'Party' };
  readonly failures = new Map<keyof SpotifyApi, SpotifyFailure>();

  failWith(method: keyof SpotifyApi, kind: SpotifyFailure): void {
    this.failures.set(method, kind);
  }

  private failure(method: keyof SpotifyApi): { ok: false; kind: SpotifyFailure } | null {
    const kind = this.failures.get(method);
    return kind ? { ok: false, kind } : null;
  }

  constructor(private readonly clock: () => number) {}

  add(track: SpotifyTrack): void {
    this.catalog.set(track.uri, track);
  }

  startContext(contextUri: string): Promise<SpotifyResult<null>> {
    void contextUri;
    this.start(this.context[this.contextIndex % this.context.length]!, 'context');
    return Promise.resolve({ ok: true, value: null });
  }

  private start(uri: string, source: 'queue' | 'context', at = this.clock()) {
    this.current = { uri, startedAt: at, pausedAt: null };
    this.log.push({ uri, startedAt: at, source });
  }

  pause(): void {
    this.advance();
    if (this.current && this.current.pausedAt === null) this.current.pausedAt = this.clock();
  }

  resume(): void {
    const current = this.current;
    if (!current || current.pausedAt === null) return;
    const pausedMs = this.clock() - current.pausedAt;
    const entry = [...this.log].reverse().find((e) => e.uri === current.uri && e.startedAt === current.startedAt);
    current.startedAt += pausedMs;
    current.pausedAt = null;
    if (entry) entry.startedAt = current.startedAt;
  }

  advance(): void {
    while (this.current && this.current.pausedAt === null) {
      const track = this.catalog.get(this.current.uri)!;
      const endsAt = this.current.startedAt + track.durationMs;
      if (endsAt > this.clock()) return;
      const next = this.queue.shift();
      if (next) this.start(next, 'queue', endsAt);
      else {
        this.contextIndex++;
        this.start(this.context[this.contextIndex % this.context.length]!, 'context', endsAt);
      }
    }
  }

  async currentlyPlaying() {
    if (this.offline) return { ok: false as const, kind: 'unknown' as const };
    this.advance();
    if (!this.current)
      return { ok: true as const, value: { isPlaying: false, progressMs: 0, track: null, contextUri: null } };
    return {
      ok: true as const,
      value: {
        isPlaying: this.current.pausedAt === null,
        progressMs: (this.current.pausedAt ?? this.clock()) - this.current.startedAt,
        track: this.catalog.get(this.current.uri)!,
        contextUri: 'spotify:playlist:preshow',
      },
    };
  }

  async addToQueue(uri: string): Promise<SpotifyResult<null>> {
    if (this.offline) return { ok: false, kind: 'unknown' };
    if (this.failQueue) return this.failQueue;
    this.advance();

    this.queue.push(uri);
    this.maxQueueLength = Math.max(this.maxQueueLength, this.queue.length);
    return { ok: true, value: null };
  }

  async skipNext(): Promise<SpotifyResult<null>> {
    return { ok: true, value: null };
  }
  async setRepeatContext(): Promise<SpotifyResult<null>> {
    return { ok: true, value: null };
  }
  async player() {
    return {
      ok: true as const,
      value: { deviceName: 'Fake', deviceActive: true, repeatState: 'context', shuffle: false },
    };
  }
  async recentlyPlayed() {
    if (this.offline) return { ok: false as const, kind: 'unknown' as const };
    this.advance();
    const finished = this.log
      .map((e) => ({ track: this.catalog.get(e.uri)!, playedAt: e.startedAt + this.catalog.get(e.uri)!.durationMs }))
      .filter((e) => e.playedAt <= this.clock());
    return { ok: true as const, value: finished.slice(-50).reverse() };
  }
  async search(query: string): Promise<SpotifyResult<SpotifyTrack[]>> {
    const failed = this.failure('search');
    if (failed) return failed;
    const q = query.toLowerCase();
    return {
      ok: true as const,
      value: [...this.catalog.values()].filter((t) => t.title.toLowerCase().includes(q)).slice(0, 10),
    };
  }
  async track(id: string): Promise<SpotifyResult<SpotifyTrack>> {
    const failed = this.failure('track');
    if (failed) return failed;
    const track = this.catalog.get(`spotify:track:${id}`);
    return track ? { ok: true, value: track } : { ok: false, kind: 'not_found' };
  }
  async playlistPage(): Promise<SpotifyResult<{ tracks: SpotifyTrack[]; next: number | null; total: number }>> {
    const failed = this.failure('playlistPage');
    if (failed) return failed;
    return { ok: true, value: { tracks: [...this.catalog.values()].slice(0, 50), next: null, total: 50 } };
  }
  async myPlaylists(): Promise<SpotifyResult<PlaylistSummary[]>> {
    return this.failure('myPlaylists') ?? { ok: true, value: this.playlists };
  }
  async me(): Promise<SpotifyResult<{ id: string; name: string | null }>> {
    return this.failure('me') ?? { ok: true, value: this.account };
  }
}

export function makeTrack(index: number, durationMs = 210_000, prefix = 'song'): SpotifyTrack {
  const id = `${prefix}${String(index).padStart(6, '0')}abcdef`;
  return {
    uri: `spotify:track:${id}`,
    title: `${prefix} title ${index}`,
    artist: `Artist ${index}`,
    album: 'Album',
    imageUrl: null,
    durationMs,
    explicit: false,
    isrc: `DE${prefix.toUpperCase().slice(0, 3)}${String(index).padStart(7, '0')}`,
  };
}
