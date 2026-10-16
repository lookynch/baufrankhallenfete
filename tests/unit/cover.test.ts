import { describe, expect, it } from 'vitest';
import { fetchCover } from '../../src/server/services/cover.ts';
import { coverPath, spotifyTrackUrl, trackIdFromUri } from '../../src/shared/spotify.ts';

const ID = 'ab67616d0000b2730123456789abcdef01234567';

function fakeFetch(handler: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return handler();
  }) as typeof fetch;
  return { fetcher, calls };
}

function image(type: string, status = 200) {
  return new Response(new Uint8Array([1, 2, 3]), { status, headers: { 'Content-Type': type } });
}

describe('Cover-Proxy', () => {
  it('fragt nur die feste Spotify-URL ab und gibt keine Client-Daten weiter', async () => {
    const { fetcher, calls } = fakeFetch(() => image('image/jpeg'));
    await fetchCover(ID, fetcher);
    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls as [{ url: string; init: RequestInit }];
    expect(url).toBe(`https://i.scdn.co/image/${ID}`);
    expect(init.headers).toEqual({ Accept: 'image/*' });
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init).not.toHaveProperty('body');
  });

  it('liefert Bilder mit privatem Browser-Cache aus', async () => {
    const { fetcher } = fakeFetch(() => image('image/JPEG; charset=binary'));
    const res = await fetchCover(ID, fetcher);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=86400, immutable');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    for (const type of ['image/png', 'image/webp']) {
      expect((await fetchCover(ID, fakeFetch(() => image(type)).fetcher)).status).toBe(200);
    }
  });

  it('cacht fehlende Bilder eine Stunde', async () => {
    const res = await fetchCover(ID, fakeFetch(() => new Response('nope', { status: 404 })).fetcher);
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
  });

  it('meldet Timeout, Weiterleitung, Serverfehler und fremde Inhaltstypen als 502', async () => {
    const cases: Array<() => Response | Promise<Response>> = [
      () => Promise.reject(new DOMException('timeout', 'TimeoutError')),
      () => new Response(null, { status: 302, headers: { Location: 'https://evil.example/x.jpg' } }),
      () => new Response('fail', { status: 500 }),
      () => image('text/html'),
      () => image('image/svg+xml'),
      () => new Response('x', { status: 200 }),
    ];
    for (const handler of cases) {
      const res = await fetchCover(ID, fakeFetch(handler).fetcher);
      expect(res.status).toBe(502);
      expect(res.headers.get('Cache-Control')).toBeNull();
    }
  });
});

describe('Spotify-Hilfsfunktionen', () => {
  it('leitet nur gültige Spotify-Cover auf den eigenen Proxy um', () => {
    expect(coverPath(`https://i.scdn.co/image/${ID}`)).toBe(`/api/cover/${ID}`);
    for (const url of [
      null,
      undefined,
      '',
      `http://i.scdn.co/image/${ID}`,
      `https://evil.example/image/${ID}`,
      `https://i.scdn.co.evil.example/image/${ID}`,
      `https://i.scdn.co/image/${ID.toUpperCase()}`,
      `https://i.scdn.co/image/${ID}?x=1`,
      `https://i.scdn.co/image/${ID.slice(1)}`,
      `https://i.scdn.co/image/${ID}0`,
      `https://mosaic.scdn.co/640/${ID}`,
    ]) {
      expect(coverPath(url)).toBeNull();
    }
  });

  it('erkennt Track-URIs und baut Spotify-Links', () => {
    expect(trackIdFromUri('spotify:track:4uLU6hMCjMI75M1A2tKUQC')).toBe('4uLU6hMCjMI75M1A2tKUQC');
    expect(spotifyTrackUrl('spotify:track:4uLU6hMCjMI75M1A2tKUQC')).toBe(
      'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC',
    );
    for (const uri of ['spotify:playlist:4uLU6hMCjMI75M1A2tKUQC', 'spotify:track:kurz', 'spotify:track:abc/../x']) {
      expect(trackIdFromUri(uri)).toBeNull();
      expect(spotifyTrackUrl(uri)).toBeNull();
    }
  });
});
