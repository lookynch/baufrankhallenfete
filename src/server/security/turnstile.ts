export async function verifyTurnstile(
  secret: string | undefined,
  token: string | undefined,
  ip: string | null,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (!secret || !token || token.length > 4096) return false;
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  try {
    const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch {
    return false;
  }
}
