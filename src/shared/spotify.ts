export const COVER_ID = /^[0-9a-f]{40}$/;
export const COVER_UPSTREAM = 'https://i.scdn.co/image/';

export function coverPath(url: string | null | undefined): string | null {
  if (!url?.startsWith(COVER_UPSTREAM)) return null;
  const id = url.slice(COVER_UPSTREAM.length);
  return COVER_ID.test(id) ? `/api/cover/${id}` : null;
}

export function trackIdFromUri(uri: string): string | null {
  const match = /^spotify:track:([A-Za-z0-9]{10,40})$/.exec(uri);
  return match?.[1] ?? null;
}

export function spotifyTrackUrl(uri: string): string | null {
  const id = trackIdFromUri(uri);
  return id ? `https://open.spotify.com/track/${id}` : null;
}
