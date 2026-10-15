import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
const migrate = spawnSync(
  join(root, 'node_modules', '.bin', 'wrangler'),
  ['d1', 'migrations', 'apply', 'fete', '--local', '--persist-to', persist],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CI: 'true' },
  },
);
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const wrangler = join(root, 'node_modules', '.bin', 'wrangler');
const server = spawn(
  wrangler,
  ['pages', 'dev', 'dist', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', persist],
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

const checks: Array<[string, () => Promise<boolean>]> = [
  [
    'Health liefert Schema-Version',
    async () => ((await (await fetch(`${base}/api/health`)).json()) as { schemaVersion: number }).schemaVersion === 2,
  ],
  [
    'Startseite mit CSP aus _headers',
    async () => {
      const res = await fetch(`${base}/`);
      return res.ok && (res.headers.get('content-security-policy') ?? '').includes("frame-ancestors 'none'");
    },
  ],
  ['SPA-Fallback für /admin', async () => (await fetch(`${base}/admin`)).ok],
  ['Display ohne Kopplung → 401', async () => (await fetch(`${base}/api/display/state`)).status === 401],
  ['Admin ohne Login → 401', async () => (await fetch(`${base}/api/admin/auth/me`)).status === 401],
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
