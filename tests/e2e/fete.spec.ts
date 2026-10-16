import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { devices, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { totpCode } from '../../src/server/security/totp.ts';

const root = join(import.meta.dirname, '..', '..');
const shots = join(root, 'test-results', 'screens');
const cspErrors: string[] = [];
const requests: string[] = [];
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

function watchConsole(page: Page) {
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy|Refused to/i.test(message.text()))
      cspErrors.push(message.text());
  });
}

async function watchNetwork(context: BrowserContext) {
  context.on('request', (request) => requests.push(request.url()));
  await context.route('**/api/cover/*', (route) => route.fulfill({ contentType: 'image/png', body: pixel }));
}

function sql(command: string) {
  execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      'fete',
      '--local',
      '--persist-to',
      join(root, '.wrangler', 'smoke'),
      '--command',
      command,
    ],
    {
      cwd: root,
      stdio: 'pipe',
      env: { ...process.env, CI: 'true' },
    },
  );
}

async function adminFetch(page: Page, method: string, path: string, body?: unknown) {
  return page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fete' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, json: await res.json() };
    },
    { method, path, body },
  );
}

test('kompletter Abend: Admin, Display, Gast, Buchhaltung', async ({ browser, baseURL }) => {
  const now = Date.now();
  const songs = Array.from({ length: 16 }, (_, i) => {
    const id = `e2esong${String(i).padStart(4, '0')}abcdefgh`;
    const image = `https://i.scdn.co/image/ab67616d0000b273${String(i).padStart(24, '0')}`;
    return `('spotify:track:${id}', 'DEE2E${String(i).padStart(7, '0')}', 'Partysong ${i + 1}', 'Band ${i + 1}', '${image}', ${180_000 + i * 5_000}, 'partysong ${i + 1}', 'band ${i + 1}', ${now})`;
  });
  sql(
    `INSERT INTO songs (spotify_uri, isrc, title, artist, image_url, duration_ms, title_norm, artist_norm, created_at) VALUES ${songs.join(', ')};
     INSERT INTO sets (name, starts_at, ends_at, default_level, created_at) VALUES ('E2E-Set', ${now - 3_600_000}, ${now + 5 * 3_600_000}, 3, ${now});
     INSERT INTO set_songs (set_id, song_id, added_at) SELECT (SELECT id FROM sets WHERE name = 'E2E-Set'), id, ${now} FROM songs;`,
  );

  const adminContext = await browser.newContext();
  await watchNetwork(adminContext);
  const admin = await adminContext.newPage();
  watchConsole(admin);
  await admin.goto('/admin/bootstrap');
  await admin.getByLabel('Bootstrap-Token').fill('local-bootstrap-token');
  await admin.getByLabel('Benutzername').fill('anna');
  await admin.getByLabel('Anzeigename').fill('Anna Admin');
  await admin.getByRole('button', { name: 'Einladung erzeugen' }).click();
  const inviteLink = await admin.locator('a[href*="/admin/invite#"]').getAttribute('href');
  expect(inviteLink).toBeTruthy();

  await admin.goto(inviteLink!);
  await expect(admin.getByText('Admin-Zugang einrichten')).toBeVisible();
  const secret = (await admin.locator('code').innerText()).trim();
  await admin.getByLabel('Neues Passwort').fill('Grüne Gurken tanzen Samba 7');
  await admin.getByLabel('Passwort wiederholen').fill('Grüne Gurken tanzen Samba 7');
  await admin
    .getByLabel('2. Angezeigten 6-stelligen Code eingeben')
    .fill(await totpCode(secret, Math.floor(Date.now() / 30_000)));
  await admin.screenshot({ path: join(shots, 'admin-invite.png'), fullPage: true });
  await admin.getByRole('button', { name: 'Zugang aktivieren' }).click();
  await expect(admin.getByText('Wiederherstellungscodes sichern')).toBeVisible();
  await admin.getByRole('button', { name: /Codes gesichert/ }).click();
  await expect(admin.getByRole('heading', { name: 'Übersicht' })).toBeVisible();

  const voting = await adminFetch(admin, 'PUT', '/api/admin/settings/voting', {
    startsAt: now - 60_000,
    enabled: true,
  });
  expect(voting.status).toBe(200);
  await adminFetch(admin, 'PUT', '/api/admin/settings/event', {
    startsAt: now - 3_600_000,
    endsAt: now + 5 * 3_600_000,
  });

  const tvContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await watchNetwork(tvContext);
  const tv = await tvContext.newPage();
  watchConsole(tv);
  await tv.goto('/display');
  const codeLocator = tv.locator('div.font-mono').filter({ hasText: /^\d{6}$/ });
  await expect(codeLocator).toBeVisible({ timeout: 20_000 });
  const pairingCode = (await codeLocator.innerText()).trim();
  await tv.screenshot({ path: join(shots, 'display-pairing.png') });

  await admin.goto('/admin/displays');
  await admin.getByLabel('Code vom Bildschirm').fill(pairingCode);
  await admin.getByLabel('Name').fill('TV Bühne');
  await admin.getByRole('button', { name: 'Koppeln' }).click();
  await expect(admin.getByText('TV Bühne')).toBeVisible();

  const qr = tv.locator('[data-qr-url]');
  await expect(qr).toBeVisible({ timeout: 30_000 });
  await expect(tv.getByText(/Runde 1/)).toBeVisible({ timeout: 30_000 });
  await expect(tv.locator('img[src^="/api/cover/"]').first()).toBeVisible();
  const qrUrl = await qr.getAttribute('data-qr-url');
  expect(qrUrl).toMatch(/\/v\/[A-Z2-7]{8}$/);

  const { defaultBrowserType: _browserType, ...iphone } = devices['iPhone 13'];
  const guestContext = await browser.newContext({
    ...iphone,
    locale: 'de-DE',
  });
  await watchNetwork(guestContext);
  const guest = await guestContext.newPage();
  watchConsole(guest);
  await guest.goto(new URL(qrUrl!).pathname);
  await expect(guest).toHaveURL(/\/$/);
  await expect(guest.getByText('Welcher Song soll laufen?')).toBeVisible({ timeout: 20_000 });
  const cover = guest.locator('ul li img').first();
  await expect(cover).toHaveAttribute('src', /^\/api\/cover\/[0-9a-f]{40}$/);
  await expect(cover).toHaveJSProperty('naturalWidth', 1);
  await expect(guest.locator('img[src*="scdn"]')).toHaveCount(0);
  await guest.screenshot({ path: join(shots, 'guest-vote.png'), fullPage: true });
  await guest.locator('ul li button').first().click();
  await expect(guest.getByText('Stimme gespeichert!')).toBeVisible();
  await expect(guest.getByText('✓ Deine Stimme')).toBeVisible();
  await guest.getByRole('button', { name: /Wunsch/ }).click();
  await expect(guest.getByText('Dein Songwunsch')).toBeVisible();
  await guest.screenshot({ path: join(shots, 'guest-wish.png'), fullPage: true });

  await expect(tv.getByText('Stimmen: 1')).toBeVisible({ timeout: 30_000 });
  await tv.screenshot({ path: join(shots, 'tv.png') });

  await admin.goto('/admin/ledger');
  await admin.getByRole('button', { name: /buchen/ }).click();
  await expect(admin.getByText('BF-0001')).toBeVisible();
  admin.once('dialog', (dialog) => void dialog.accept('Testbuchung'));
  await admin.getByRole('button', { name: 'Storno' }).first().click();
  await expect(admin.getByText('BF-0002')).toBeVisible();
  await admin.screenshot({ path: join(shots, 'admin-ledger.png'), fullPage: true });

  const barContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await watchNetwork(barContext);
  for (const kind of ['bar_stats', 'bar_ledger'] as const) {
    const bar = await barContext.newPage();
    watchConsole(bar);
    await barContext.clearCookies();
    await bar.goto('/display');
    const barCode = bar.locator('div.font-mono').filter({ hasText: /^\d{6}$/ });
    await expect(barCode).toBeVisible({ timeout: 20_000 });
    await adminFetch(admin, 'POST', '/api/admin/displays/claim', {
      code: (await barCode.innerText()).trim(),
      name: kind,
      kind,
    });
    await expect(bar.getByRole('heading', { name: kind === 'bar_stats' ? /Stattrack/ : /Buchhaltung/ })).toBeVisible({
      timeout: 20_000,
    });
    await bar.waitForTimeout(1_000);
    await bar.screenshot({ path: join(shots, `${kind}.png`) });
  }

  for (const path of [
    '/admin',
    '/admin/rounds',
    '/admin/music?tab=sets',
    '/admin/wishes',
    '/admin/settings',
    '/admin/users',
    '/admin/audit',
  ]) {
    await admin.goto(path);
    await admin.waitForLoadState('networkidle');
    await admin.screenshot({ path: join(shots, `admin${path.replace(/[/?=]/g, '-')}.png`), fullPage: true });
  }

  expect(cspErrors).toEqual([]);
  expect(requests.some((url) => url.includes('/api/cover/'))).toBe(true);
  const origin = new URL(baseURL!).origin;
  expect(requests.filter((url) => /^https?:/.test(url) && new URL(url).origin !== origin)).toEqual([]);
});
