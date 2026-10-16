import { hex, theme } from './theme.ts';

export const pwaApps = {
  guest: { id: '/fete/', scope: '/fete', startUrl: '/fete/', name: theme.event.name, shortName: 'Fete' },
  admin: {
    id: '/admin/',
    scope: '/admin',
    startUrl: '/admin/',
    name: `${theme.event.name} Admin`,
    shortName: 'Fete Admin',
  },
} as const;

export type PwaApp = keyof typeof pwaApps;

export const guestHome = pwaApps.guest.startUrl;

export const pwaIcons = [
  { name: '192', size: 192, maskable: false },
  { name: '512', size: 512, maskable: false },
  { name: 'maskable-512', size: 512, maskable: true },
  { name: 'apple-touch-icon', size: 180, maskable: false },
] as const;

export function pwaAppAt(pathname: string): PwaApp | null {
  const app = (Object.keys(pwaApps) as PwaApp[]).find((key) => {
    const scope = pwaApps[key].scope;
    return pathname === scope || pathname.startsWith(`${scope}/`);
  });
  return app ?? null;
}

export function iconPath(app: PwaApp, icon: (typeof pwaIcons)[number]['name']): string {
  return `/pwa/${app}-${icon}.png`;
}

export function manifestPath(app: PwaApp): string {
  return `/pwa/${app}.webmanifest`;
}

export function pwaHeadTags(app: PwaApp): string {
  return [
    `<link rel="manifest" href="${manifestPath(app)}" />`,
    `<link rel="apple-touch-icon" href="${iconPath(app, 'apple-touch-icon')}" />`,
    '<meta name="mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-capable" content="yes" />',
    `<meta name="apple-mobile-web-app-title" content="${pwaApps[app].shortName}" />`,
    '<meta name="apple-mobile-web-app-status-bar-style" content="black" />',
  ].join('\n    ');
}

export function webManifest(app: PwaApp) {
  const config = pwaApps[app];
  return {
    id: config.id,
    name: config.name,
    short_name: config.shortName,
    lang: 'de',
    start_url: config.startUrl,
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
