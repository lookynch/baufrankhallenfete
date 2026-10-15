import type { SpotifyApi, SpotifyResult, SpotifyTrack } from '../../src/server/services/spotify-api.ts';

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
  current: { uri: string; startedAt: number } | null = null;
  failQueue: SpotifyResult<null> | null = null;
  maxQueueLength = 0;
  offline = false;

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
    this.current = { uri, startedAt: at };
    this.log.push({ uri, startedAt: at, source });
  }

  advance(): void {
    while (this.current) {
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
    if (!this.current) return { ok: true as const, value: { isPlaying: false, progressMs: 0, track: null, contextUri: null } };
    return {
      ok: true as const,
      value: {
        isPlaying: true,
        progressMs: this.clock() - this.current.startedAt,
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
    return { ok: true as const, value: { deviceName: 'Fake', deviceActive: true, repeatState: 'context', shuffle: false } };
  }
  async recentlyPlayed() {
    if (this.offline) return { ok: false as const, kind: 'unknown' as const };
    this.advance();
    const finished = this.log
      .map((e) => ({ track: this.catalog.get(e.uri)!, playedAt: e.startedAt + this.catalog.get(e.uri)!.durationMs }))
      .filter((e) => e.playedAt <= this.clock());
    return { ok: true as const, value: finished.slice(-50).reverse() };
  }
  async search(query: string) {
    const q = query.toLowerCase();
    return { ok: true as const, value: [...this.catalog.values()].filter((t) => t.title.toLowerCase().includes(q)).slice(0, 10) };
  }
  async track(id: string): Promise<SpotifyResult<SpotifyTrack>> {
    const track = this.catalog.get(`spotify:track:${id}`);
    return track ? { ok: true, value: track } : { ok: false, kind: 'not_found' };
  }
  async playlistPage() {
    return { ok: true as const, value: { tracks: [...this.catalog.values()].slice(0, 50), next: null, total: 50 } };
  }
  async myPlaylists() {
    return { ok: true as const, value: [] };
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
