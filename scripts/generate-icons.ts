import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { iconPath, pwaApps, pwaIcons, type PwaApp } from '../src/shared/pwa.ts';
import { hex, theme } from '../src/shared/theme.ts';

const CROP_PER_SIDE = 0.14;
const MASKABLE_ART_SCALE = 0.72;

const root = join(import.meta.dirname, '..');
const apps = Object.keys(pwaApps) as PwaApp[];

const sources = apps.map((app) => {
  const file = join(root, 'assets', 'pwa', `${app}.png`);
  if (!existsSync(file)) throw new Error(`${file} fehlt – quadratisches PNG (mindestens 512 px) ablegen`);
  return { app, dataUrl: `data:image/png;base64,${readFileSync(file).toString('base64')}` };
});

function croppedArt(dataUrl: string, scale: number, style = ''): string {
  const zoom = 100 / (1 - 2 * CROP_PER_SIDE);
  const offset = (100 - zoom) / 2;
  const inset = ((1 - scale) / 2) * 100;
  return `<div style="position:absolute;inset:${inset}%;overflow:hidden;${style}">
    <img src="${dataUrl}" style="position:absolute;width:${zoom}%;left:${offset}%;top:${offset}%">
  </div>`;
}

function iconHtml(dataUrl: string, size: number, maskable: boolean): string {
  const layers = maskable
    ? croppedArt(dataUrl, 1.2, `filter:blur(${size * 0.03}px) brightness(0.75)`) +
      croppedArt(dataUrl, MASKABLE_ART_SCALE, 'mask-image:radial-gradient(closest-side,black 82%,transparent 100%)')
    : croppedArt(dataUrl, 1);
  return `<body style="margin:0"><div id="icon" style="position:relative;overflow:hidden;width:${size}px;height:${size}px;background:${hex(theme.colors.background)}">${layers}</div></body>`;
}

const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
);
const page = await browser.newPage();
for (const { app, dataUrl } of sources) {
  for (const icon of pwaIcons) {
    await page.setViewportSize({ width: icon.size, height: icon.size });
    await page.setContent(iconHtml(dataUrl, icon.size, icon.maskable));
    await page.waitForFunction(() => [...document.images].every((img) => img.complete));
    const path = join(root, 'public', iconPath(app, icon.name));
    await page.locator('#icon').screenshot({ path });
    console.info(path);
  }
}
await browser.close();
