import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentSecurityPolicy } from '../src/server/security/headers.ts';

const dist = join(import.meta.dirname, '..', 'dist');
const problems: string[] = [];

for (const file of ['index.html', '_routes.json', '_headers', 'logo.svg']) {
  if (!existsSync(join(dist, file))) problems.push(`dist/${file} fehlt`);
}
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
