import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '..');
const allowed = new Set(['src/shared/theme.ts']);
const pattern = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(\s*[\d.]/g;
const findings: string[] = [];

function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(tsx?|css)$/.test(name)) check(path);
  }
}

function check(path: string) {
  const rel = relative(root, path).replaceAll('\\', '/');
  if (allowed.has(rel)) return;
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      for (const match of line.matchAll(pattern)) findings.push(`${rel}:${index + 1}  ${match[0]}`);
    });
}

walk(join(root, 'src'));

if (findings.length) {
  console.error(`Farben dürfen nur in src/shared/theme.ts definiert werden:\n${findings.join('\n')}`);
  process.exit(1);
}
console.info('Theme-Prüfung OK');
