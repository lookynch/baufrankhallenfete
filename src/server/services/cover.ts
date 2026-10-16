import { COVER_UPSTREAM } from '../../shared/spotify.ts';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function fetchCover(id: string, fetcher: typeof fetch = fetch): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetcher(`${COVER_UPSTREAM}${id}`, {
      headers: { Accept: 'image/*' },
      redirect: 'manual',
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return Response.json({ error: 'cover_unavailable' }, { status: 502 });
  }
  const type = upstream.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (upstream.status === 200 && IMAGE_TYPES.has(type)) {
    return new Response(upstream.body, {
      headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400, immutable' },
    });
  }
  await upstream.body?.cancel();
  if (upstream.status === 404) {
    return Response.json(
      { error: 'not_found' },
      { status: 404, headers: { 'Cache-Control': 'private, max-age=3600' } },
    );
  }
  return Response.json({ error: 'cover_unavailable' }, { status: 502 });
}
