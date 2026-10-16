import { iconPath, manifestPath, pwaAppFor, pwaApps } from '../../shared/pwa.ts';

export function applyPwaApp(pathname = window.location.pathname): void {
  const app = pwaAppFor(pathname);
  document.querySelector('link[rel="manifest"]')?.setAttribute('href', manifestPath(app));
  document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute('href', iconPath(app, 'apple-touch-icon'));
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', pwaApps[app].shortName);
}
