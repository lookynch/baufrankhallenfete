import type { ArtistTag, Lastfm, TopTagsResult } from '../../src/server/services/genres.ts';

export class FakeLastfm implements Lastfm {
  readonly tags = new Map<string, ArtistTag[]>();
  readonly calls: string[] = [];
  offline = false;
  rateLimited = false;

  tag(artist: string, ...tags: Array<[string, number]>): void {
    this.tags.set(
      artist,
      tags.map(([name, weight]) => ({ name, weight })),
    );
  }

  async topTags(artist: string): Promise<TopTagsResult> {
    this.calls.push(artist);
    if (this.rateLimited) return { ok: false, rateLimited: true };
    if (this.offline) return { ok: false, rateLimited: false };
    return { ok: true, tags: this.tags.get(artist) ?? [] };
  }
}
