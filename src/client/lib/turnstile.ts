interface TurnstileApi {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loader: Promise<TurnstileApi | null> | null = null;

function loadTurnstile(): Promise<TurnstileApi | null> {
  loader ??= new Promise((resolve) => {
    if (window.turnstile) return resolve(window.turnstile);
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => resolve(window.turnstile ?? null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return loader;
}

export async function turnstileToken(siteKey: string | null, timeoutMs = 8_000): Promise<string | undefined> {
  if (!siteKey) return undefined;
  const turnstile = await Promise.race([
    loadTurnstile(),
    new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
  ]);
  if (!turnstile) return undefined;
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.bottom = '8px';
  container.style.right = '8px';
  container.style.zIndex = '50';
  document.body.appendChild(container);
  return new Promise((resolve) => {
    let widgetId = '';
    const finish = (token?: string) => {
      clearTimeout(timer);
      try {
        turnstile.remove(widgetId);
      } catch {
        widgetId = '';
      }
      container.remove();
      resolve(token);
    };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    widgetId = turnstile.render(container, {
      sitekey: siteKey,
      appearance: 'interaction-only',
      callback: (token: string) => finish(token),
      'error-callback': () => finish(undefined),
    });
  });
}
