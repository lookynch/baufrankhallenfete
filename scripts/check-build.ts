import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentSecurityPolicy } from '../src/server/security/headers.ts';
import { iconPath, manifestPath, pwaApps, pwaIcons, type PwaApp } from '../src/shared/pwa.ts';

const dist = join(import.meta.dirname, '..', 'dist');
const problems: string[] = [];

for (const file of ['index.html', '_routes.json', '_headers', 'logo.svg']) {
  if (!existsSync(join(dist, file))) problems.push(`dist/${file} fehlt`);
}
const manifestIds = new Set<string>();
for (const app of Object.keys(pwaApps) as PwaApp[]) {
  for (const icon of pwaIcons) {
    if (!existsSync(join(dist, iconPath(app, icon.name)))) problems.push(`dist${iconPath(app, icon.name)} fehlt`);
  }
  const manifestFile = join(dist, manifestPath(app));
  if (!existsSync(manifestFile)) {
    problems.push(`dist${manifestPath(app)} fehlt`);
    continue;
  }
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as { id: string; icons: Array<{ src: string }> };
  manifestIds.add(manifest.id);
  for (const icon of manifest.icons) {
    if (!existsSync(join(dist, icon.src))) problems.push(`${manifestPath(app)} verweist auf fehlendes ${icon.src}`);
  }
}
if (manifestIds.size !== Object.keys(pwaApps).length) problems.push('Web-App-Manifeste brauchen unterschiedliche ids');
if (!existsSync(join(dist, 'assets')) || !readdirSync(join(dist, 'assets')).some((f) => f.endsWith('.js'))) {
  problems.push('dist/assets enthält kein JavaScript');
}
if (existsSync(join(dist, '_routes.json'))) {
  const routes = JSON.parse(readFileSync(join(dist, '_routes.json'), 'utf8')) as { include?: string[] };
  if (JSON.stringify(routes.include) !== JSON.stringify(['/api/*']))
    problems.push('_routes.json darf Functions nur für /api/* aktivieren');
}
if (existsSync(join(dist, '_headers'))) {
  const headers = readFileSync(join(dist, '_headers'), 'utf8');
  if (!headers.includes(`Content-Security-Policy: ${contentSecurityPolicy}`)) {
    problems.push('CSP in public/_headers weicht von src/server/security/headers.ts ab');
  }
}
if (existsSync(join(dist, 'index.html'))) {
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) problems.push('index.html enthält Inline-Skripte (CSP)');
  if (/\sstyle=/i.test(html)) problems.push('index.html enthält Inline-Styles (CSP)');
}

if (problems.length) {
  console.error(`Build-Prüfung fehlgeschlagen:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.info('Build-Prüfung OK');
