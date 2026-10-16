import { hex, theme } from './theme.ts';

export const pwaApps = {
  guest: { id: '/', scope: '/', name: theme.event.name, shortName: 'Fete' },
  admin: { id: '/admin/', scope: '/admin/', name: `${theme.event.name} Admin`, shortName: 'Fete Admin' },
} as const;

export type PwaApp = keyof typeof pwaApps;

export const pwaIcons = [
  { name: '192', size: 192, maskable: false },
  { name: '512', size: 512, maskable: false },
  { name: 'maskable-512', size: 512, maskable: true },
  { name: 'apple-touch-icon', size: 180, maskable: false },
] as const;

export function pwaAppFor(pathname: string): PwaApp {
  return pathname === '/admin' || pathname.startsWith('/admin/') ? 'admin' : 'guest';
}

export function iconPath(app: PwaApp, icon: (typeof pwaIcons)[number]['name']): string {
  return `/pwa/${app}-${icon}.png`;
}

export function manifestPath(app: PwaApp): string {
  return `/pwa/${app}.webmanifest`;
}

export function webManifest(app: PwaApp) {
  const config = pwaApps[app];
  return {
    id: config.id,
    name: config.name,
    short_name: config.shortName,
    lang: 'de',
    start_url: config.scope,
    scope: config.scope,
    display: 'standalone',
    background_color: hex(theme.colors.background),
    theme_color: hex(theme.colors.background),
    icons: pwaIcons
      .filter((icon) => icon.name !== 'apple-touch-icon')
      .map((icon) => ({
        src: iconPath(app, icon.name),
        sizes: `${icon.size}x${icon.size}`,
        type: 'image/png',
        purpose: icon.maskable ? 'maskable' : 'any',
      })),
  };
}
