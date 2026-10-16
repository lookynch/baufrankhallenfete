import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { iconPath, pwaApps, pwaIcons, type PwaApp } from '../src/shared/pwa.ts';
import { hex, theme } from '../src/shared/theme.ts';

const root = join(import.meta.dirname, '..');
const apps = Object.keys(pwaApps) as PwaApp[];

const sources = apps.map((app) => {
  const file = join(root, 'assets', 'pwa', `${app}.png`);
  if (!existsSync(file)) throw new Error(`${file} fehlt – quadratisches PNG (mindestens 512 px) ablegen`);
  return { app, dataUrl: `data:image/png;base64,${readFileSync(file).toString('base64')}` };
});

const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
);
const page = await browser.newPage();
for (const { app, dataUrl } of sources) {
  for (const icon of pwaIcons) {
    await page.setViewportSize({ width: icon.size, height: icon.size });
    await page.setContent(
      `<body style="margin:0;background:${hex(theme.colors.background)}"><img src="${dataUrl}" width="${icon.size}" height="${icon.size}" style="display:block"></body>`,
    );
    const path = join(root, 'public', iconPath(app, icon.name));
    await page.locator('img').screenshot({ path });
    console.info(path);
  }
}
await browser.close();
