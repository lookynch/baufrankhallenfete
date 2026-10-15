import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Runtime } from './env.ts';
import { requiredSecrets } from './env.ts';
import { fail, sameOrigin, type AppEnv } from './http.ts';
import { securityHeaders } from './security/headers.ts';
import { adminGuard, authRoutes, requireAdmin } from './routes/admin/auth.ts';
import { musicRoutes } from './routes/admin/music.ts';
import { ownerRoutes, systemRoutes } from './routes/admin/system.ts';
import { buzzerRoutes } from './routes/buzzer.ts';
import { displayRoutes } from './routes/display.ts';
import { publicRoutes } from './routes/public.ts';
import { getKv } from './services/kv.ts';
import { createHttpSpotify } from './services/spotify-http.ts';

export interface AppOptions {
  now?: () => number;
  spotify?: (env: Env, now: () => number) => Runtime['spotify'];
}

export function createApp(options: AppOptions = {}) {
  const app = new Hono<AppEnv>().basePath('/api');
  const now = options.now ?? (() => Date.now());
  const spotifyFactory = options.spotify ?? createHttpSpotify;

  app.use('*', async (c, next) => {
    const missing = requiredSecrets.filter((key) => !c.env[key]);
    if (missing.length) {
      console.error(`missing secrets: ${missing.join(', ')}`);
      fail(503, 'server_not_configured');
    }
    let waitUntil: Runtime['waitUntil'];
    try {
      const ctx = c.executionCtx;
      waitUntil = (promise) => ctx.waitUntil(promise.catch((error: unknown) => console.error('background task failed', error)));
    } catch {
      waitUntil = (promise) => void promise.catch((error: unknown) => console.error('background task failed', error));
    }
    c.set('rt', { env: c.env, now, waitUntil, spotify: spotifyFactory(c.env, now) });
    await next();
    for (const [name, value] of Object.entries(securityHeaders)) c.header(name, value);
    c.header('Cache-Control', 'no-store');
  });

  app.use('/public/*', async (c, next) => {
    if (c.req.method !== 'GET' && !sameOrigin(c)) fail(403, 'csrf_check_failed');
    await next();
  });
  app.use('/display/*', async (c, next) => {
    if (c.req.method !== 'GET' && !sameOrigin(c)) fail(403, 'csrf_check_failed');
    await next();
  });

  app.get('/health', async (c) => {
    const schema = await getKv<string>(c.env.DB, 'schema_version');
    return c.json({ ok: true, schemaVersion: schema?.value ?? null, time: now() });
  });

  app.route('/public', publicRoutes);
  app.route('/display', displayRoutes);
  app.route('/buzzer', buzzerRoutes);

  const admin = new Hono<AppEnv>();
  admin.use('*', adminGuard);
  admin.route('/auth', authRoutes);
  admin.use('*', requireAdmin);
  admin.route('/', musicRoutes);
  admin.route('/', systemRoutes);
  admin.route('/', ownerRoutes);
  app.route('/admin', admin);

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((error, c) => {
    const response = error instanceof HTTPException ? error.getResponse() : null;
    if (!response) console.error('unhandled error', error);
    const res = response ?? Response.json({ error: 'internal_error' }, { status: 500 });
    const headers = new Headers(res.headers);
    for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
    headers.set('Cache-Control', 'no-store');
    return new Response(res.body, { status: res.status, headers });
  });

  return app;
}
