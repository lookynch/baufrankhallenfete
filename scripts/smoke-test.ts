import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RETENTION_SQL } from '../src/server/services/retention.ts';

const root = join(import.meta.dirname, '..');
const port = Number(process.env.SMOKE_PORT ?? 8799);
const base = `http://127.0.0.1:${port}`;
const persist = join(root, '.wrangler', 'smoke');
const devVars = join(root, '.dev.vars');
const keepServer = process.argv.includes('--serve');

if (!existsSync(devVars)) {
  const secret = (name: string) => `${name}=${name.toLowerCase()}-local-${Math.random().toString(36).slice(2)}`;
  writeFileSync(
    devVars,
    [
      ...['SESSION_PEPPER', 'COOKIE_SECRET', 'QR_SECRET', 'IP_HASH_SECRET', 'BUZZER_HMAC_SECRET', 'ENC_KEY'].map(
        secret,
      ),
      'BOOTSTRAP_TOKEN=local-bootstrap-token',
      'PBKDF2_ITERATIONS=20000',
    ].join('\n') + '\n',
  );
}

rmSync(persist, { recursive: true, force: true });
const wrangler = join(root, 'node_modules', '.bin', 'wrangler');
const d1 = (...args: string[]) =>
  spawnSync(wrangler, ['d1', ...args, '--local', '--persist-to', persist], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CI: 'true' },
  }).status;
const migrate = d1('migrations', 'apply', 'fete');
if (migrate !== 0) process.exit(migrate ?? 1);
const retentionRuns = [1, 2].map(() => d1('execute', 'fete', '--command', RETENTION_SQL));

const server = spawn(
  wrangler,
  [
    'pages',
    'dev',
    'dist',
    '--port',
    String(port),
    '--ip',
    '127.0.0.1',
    '--persist-to',
    persist,
    '--binding',
    `WEBAUTHN_ORIGIN=http://localhost:${port}`,
  ],
  {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: 'true' },
  },
);
let output = '';
server.stdout.on('data', (d: Buffer) => (output += d.toString()));
server.stderr.on('data', (d: Buffer) => (output += d.toString()));

function stop() {
  server.kill('SIGTERM');
}

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server nicht erreichbar:\n${output}`);
}

async function redirectTarget(path: string): Promise<string> {
  const res = await fetch(`${base}${path}`, { redirect: 'manual' });
  const location = res.headers.get('location') ?? '';
  return res.status >= 300 && res.status < 400 ? location.replace(base, '') : '';
}

async function manifestOf(path: string): Promise<string | null> {
  const res = await fetch(`${base}${path}`, { redirect: 'manual' });
  if (res.status !== 200) return null;
  return /<link rel="manifest" href="([^"]+)"/.exec(await res.text())?.[1] ?? '';
}

const checks: Array<[string, () => Promise<boolean>]> = [
  ['Löschfristen-SQL läuft zweimal gegen lokale D1', async () => retentionRuns.every((status) => status === 0)],
  [
    'Health liefert Schema-Version',
    async () => ((await (await fetch(`${base}/api/health`)).json()) as { schemaVersion: number }).schemaVersion === 6,
  ],
  [
    'Startseite mit CSP aus _headers, ohne Fremdhosts',
    async () => {
      const res = await fetch(`${base}/fete/`);
      const csp = res.headers.get('content-security-policy') ?? '';
      return res.ok && csp.includes("frame-ancestors 'none'") && !csp.includes('https:');
    },
  ],
  [
    'Alte Gast-Adressen leiten auf /fete um',
    async () => (await redirectTarget('/')) === '/fete/' && (await redirectTarget('/v/ABC?x=1')) === '/fete/v/ABC?x=1',
  ],
  [
    'Gast-Seiten tragen das Gast-Manifest',
    async () =>
      (await Promise.all(['/fete/', '/fete/v/ABC', '/fete/datenschutz'].map(manifestOf))).every(
        (m) => m === '/pwa/guest.webmanifest',
      ),
  ],
  [
    'Admin-Seiten tragen das Admin-Manifest',
    async () =>
      (await Promise.all(['/admin/', '/admin/rounds', '/admin/spotify/callback?code=x'].map(manifestOf))).every(
        (m) => m === '/pwa/admin.webmanifest',
      ),
  ],
  [
    '/fete und /admin ohne Schrägstrich leiten genau einmal um',
    async () => (await redirectTarget('/fete')) === '/fete/' && (await redirectTarget('/admin')) === '/admin/',
  ],
  [
    'Display und Rechtsseiten ohne Manifest',
    async () => (await Promise.all(['/display', '/datenschutz', '/impressum'].map(manifestOf))).every((m) => m === ''),
  ],
  ['Cover-Proxy mit ungültiger ID → 404', async () => (await fetch(`${base}/api/cover/abc`)).status === 404],
  ['Display ohne Kopplung → 401', async () => (await fetch(`${base}/api/display/state`)).status === 401],
  ['Admin ohne Login → 401', async () => (await fetch(`${base}/api/admin/auth/me`)).status === 401],
  [
    'Web-App-Manifeste für Gast und Admin',
    async () => {
      const ids = await Promise.all(
        ['guest', 'admin'].map(
          async (app) => ((await (await fetch(`${base}/pwa/${app}.webmanifest`)).json()) as { id: string }).id,
        ),
      );
      return ids.join(' ') === '/fete/ /admin/';
    },
  ],
  [
    'Passkey-Optionen aus der Workers-Runtime',
    async () => {
      const res = await fetch(`${base}/api/admin/auth/passkey/options`, {
        method: 'POST',
        body: '{}',
        headers: { Origin: base, 'X-Requested-With': 'fete', 'Content-Type': 'application/json' },
      });
      return res.ok && ((await res.json()) as { rpId: string }).rpId === 'localhost';
    },
  ],
  [
    'Gast-POST ohne Origin → 403',
    async () =>
      (
        await fetch(`${base}/api/public/join`, {
          method: 'POST',
          body: '{}',
          headers: { 'Content-Type': 'application/json' },
        })
      ).status === 403,
  ],
  [
    'Gast-Löschung ohne Cookie → 401',
    async () =>
      (await fetch(`${base}/api/public/forget`, { method: 'POST', headers: { Origin: base } })).status === 401,
  ],
  [
    'Buzzer mit falscher Signatur → 401',
    async () =>
      (
        await fetch(`${base}/api/buzzer/press`, {
          method: 'POST',
          body: '{}',
          headers: { 'X-Fete-Agent': 'smoke', 'X-Fete-Timestamp': String(Date.now()), 'X-Fete-Signature': '00' },
        })
      ).status === 401,
  ],
  [
    'Function-Antworten tragen Sicherheits-Header',
    async () => (await fetch(`${base}/api/health`)).headers.get('x-frame-options') === 'DENY',
  ],
];

try {
  await waitForServer();
  let failed = 0;
  for (const [name, check] of checks) {
    const ok = await check().catch(() => false);
    if (!ok) failed++;
    console.info(`${ok ? '✔' : '✘'} ${name}`);
  }
  if (keepServer) {
    console.info(`Server läuft auf ${base} (Strg+C beendet)`);
    await new Promise(() => undefined);
  }
  stop();
  process.exit(failed ? 1 : 0);
} catch (error) {
  console.error(error);
  stop();
  process.exit(1);
}
