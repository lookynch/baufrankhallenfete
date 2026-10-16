import type { Env } from '../env.ts';
import { getKv } from './kv.ts';

const LASTFM_API = 'https://ws.audioscrobbler.com/2.0/';
const LASTFM_TIMEOUT_MS = 1_500;
const LASTFM_BACKOFF_KEY = 'lastfm_backoff_until';
const LASTFM_BACKOFF_MS = 60_000;
const LASTFM_PARALLEL = 4;
const LASTFM_NOT_FOUND = 6;
const LASTFM_RATE_LIMITED = 29;
const MIN_TAG_WEIGHT = 10;
const TAGS_FRESH_MS = 30 * 24 * 3_600_000;
const RETRY_DELAYS_MS = [10 * 60_000, 30 * 60_000, 60 * 60_000];

export const BLOCK_MIN_WEIGHT = 60;
export const NEW_ARTISTS_PER_SEARCH = 5;

const LEVEL_HINTS: Record<number, string[]> = {
  1: ['ambient', 'chillout', 'acoustic', 'jazz', 'classical', 'lo fi'],
  2: ['soul', 'indie', 'singer songwriter', 'reggae'],
  3: ['pop', 'rock', 'hip hop', 'rnb'],
  4: ['dance', 'disco', 'funk', '80s', 'schlager'],
  5: ['house', 'edm', 'eurodance', 'techno', 'party', 'ballermann'],
};

const levelByTerm = new Map(
  Object.entries(LEVEL_HINTS).flatMap(([level, terms]) => terms.map((term) => [term, Number(level)] as const)),
);

export interface ArtistTag {
  name: string;
  weight: number;
}

export type TopTagsResult = { ok: true; tags: ArtistTag[] } | { ok: false; rateLimited: boolean };

export interface Lastfm {
  topTags(artist: string): Promise<TopTagsResult>;
}

export type ArtistTags = { known: true; tags: ArtistTag[] } | { known: false };

export type TrackVerdict =
  { kind: 'allowed'; level: number | null } | { kind: 'blocked'; tag: string } | { kind: 'unknown' };

export function normalizeTag(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export const artistKey = normalizeTag;

function phrases(tag: string): string[] {
  const words = normalizeTag(tag).split(' ').filter(Boolean);
  const out: string[] = [];
  for (let start = 0; start < words.length; start++) {
    for (let end = start + 1; end <= words.length; end++) out.push(words.slice(start, end).join(' '));
  }
  return out;
}

export function blockedTermSet(terms: string[]): Set<string> {
  return new Set(terms.map(normalizeTag).filter(Boolean));
}

export function classify(tags: ArtistTag[], blocked: Set<string>): { blockedTag: string | null; level: number | null } {
  let blockedTag: string | null = null;
  let best: { weight: number; level: number } | null = null;
  for (const tag of tags) {
    const parts = phrases(tag.name);
    if (!blockedTag && tag.weight >= BLOCK_MIN_WEIGHT && parts.some((p) => blocked.has(p))) blockedTag = tag.name;
    const level = parts.map((p) => levelByTerm.get(p)).find((l) => l !== undefined);
    if (level === undefined) continue;
    if (!best || tag.weight > best.weight || (tag.weight === best.weight && level < best.level)) {
      best = { weight: tag.weight, level };
    }
  }
  return { blockedTag, level: best?.level ?? null };
}

export function verdictFor(
  artist: string | undefined,
  tags: Map<string, ArtistTags>,
  blocked: Set<string>,
): TrackVerdict {
  if (!artist) return { kind: 'allowed', level: null };
  const entry = tags.get(artistKey(artist));
  if (!entry?.known) return { kind: 'unknown' };
  const result = classify(entry.tags, blocked);
  return result.blockedTag ? { kind: 'blocked', tag: result.blockedTag } : { kind: 'allowed', level: result.level };
}

interface RawTopTags {
  error?: number;
  toptags?: { tag?: Array<{ name?: string; count?: number }> | { name?: string; count?: number } };
}

export function createLastfm(env: Env, fetcher: typeof fetch = fetch): Lastfm | null {
  const key = env.LASTFM_API_KEY;
  if (!key) return null;
  return {
    async topTags(artist) {
      const url = new URL(LASTFM_API);
      url.search = new URLSearchParams({
        method: 'artist.gettoptags',
        artist,
        autocorrect: '1',
        api_key: key,
        format: 'json',
      }).toString();
      try {
        const response = await fetcher(url, { signal: AbortSignal.timeout(LASTFM_TIMEOUT_MS) });
        const body = (await response.json()) as RawTopTags;
        if (body.error === LASTFM_NOT_FOUND) return { ok: true, tags: [] };
        if (body.error === LASTFM_RATE_LIMITED || response.status === 429) return { ok: false, rateLimited: true };
        if (!response.ok || body.error !== undefined || !body.toptags) return { ok: false, rateLimited: false };
        const raw = body.toptags.tag ?? [];
        const tags = (Array.isArray(raw) ? raw : [raw])
          .map((t) => ({ name: String(t.name ?? '').slice(0, 60), weight: Number(t.count ?? 0) }))
          .filter((t) => t.name && t.weight >= MIN_TAG_WEIGHT)
          .slice(0, 20);
        return { ok: true, tags };
      } catch {
        return { ok: false, rateLimited: false };
      }
    },
  };
}

interface TagRow {
  artist_key: string;
  tags: string;
  fetched_at: number;
  failures: number;
  failed_until: number | null;
}

async function inBatches<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

export async function loadArtistTags(
  db: D1Database,
  lastfm: Lastfm,
  artists: string[],
  now: number,
  maxFetch: number,
): Promise<Map<string, ArtistTags>> {
  const names = new Map<string, string>();
  for (const name of artists) {
    const key = artistKey(name);
    if (key && !names.has(key)) names.set(key, name);
  }
  const out = new Map<string, ArtistTags>();
  if (names.size === 0) return out;
  const keys = [...names.keys()];
  const { results } = await db
    .prepare(`SELECT * FROM artist_tags WHERE artist_key IN (${keys.map((_, i) => `?${i + 1}`).join(', ')})`)
    .bind(...keys)
    .all<TagRow>();
  const rows = new Map(results.map((r) => [r.artist_key, r]));
  const due: string[] = [];
  for (const key of keys) {
    const row = rows.get(key);
    if (row && row.fetched_at > 0) out.set(key, { known: true, tags: JSON.parse(row.tags) as ArtistTag[] });
    else out.set(key, { known: false });
    const stale = !row || row.fetched_at <= now - TAGS_FRESH_MS;
    if (stale && (row?.failed_until ?? 0) <= now) due.push(key);
  }
  const fetchKeys = due.slice(0, maxFetch);
  if (fetchKeys.length === 0) return out;
  const backoff = await getKv<number>(db, LASTFM_BACKOFF_KEY);
  if (backoff && backoff.value > now) return out;

  const fetched = await inBatches(fetchKeys, LASTFM_PARALLEL, (key) => lastfm.topTags(names.get(key)!));
  const statements: D1PreparedStatement[] = [];
  fetched.forEach((result, index) => {
    const key = fetchKeys[index]!;
    if (result.ok) {
      out.set(key, { known: true, tags: result.tags });
      statements.push(
        db
          .prepare(
            `INSERT INTO artist_tags (artist_key, tags, fetched_at, failures, failed_until) VALUES (?1, ?2, ?3, 0, NULL)
             ON CONFLICT (artist_key) DO UPDATE SET
               tags = excluded.tags, fetched_at = excluded.fetched_at, failures = 0, failed_until = NULL`,
          )
          .bind(key, JSON.stringify(result.tags), now),
      );
      return;
    }
    const failures = (rows.get(key)?.failures ?? 0) + 1;
    const delay = RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length) - 1]!;
    statements.push(
      db
        .prepare(
          `INSERT INTO artist_tags (artist_key, tags, fetched_at, failures, failed_until) VALUES (?1, '[]', 0, ?2, ?3)
           ON CONFLICT (artist_key) DO UPDATE SET failures = excluded.failures, failed_until = excluded.failed_until`,
        )
        .bind(key, failures, now + delay),
    );
  });
  if (fetched.some((r) => !r.ok && r.rateLimited)) {
    statements.push(
      db
        .prepare(
          `INSERT INTO kv (key, value, updated_at) VALUES (?1, ?2, ?3)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .bind(LASTFM_BACKOFF_KEY, JSON.stringify(now + LASTFM_BACKOFF_MS), now),
    );
  }
  await db.batch(statements);
  return out;
}
