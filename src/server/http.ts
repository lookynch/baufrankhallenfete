import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';
import type { Env, Runtime } from './env.ts';
import type { AdminPrincipal } from './security/session.ts';
import { ipKeyHash } from './security/ip.ts';

export interface AppVariables {
  rt: Runtime;
  admin: AdminPrincipal;
}

export type AppEnv = { Bindings: Env; Variables: AppVariables };
export type AppContext = Context<AppEnv>;

export function fail(
  status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503,
  error: string,
  extra?: object,
): never {
  throw new HTTPException(status, { res: Response.json({ error, ...extra }, { status }) });
}

export async function body<T extends z.ZodType>(c: AppContext, schema: T, maxBytes = 16_384): Promise<z.infer<T>> {
  const length = Number(c.req.header('content-length') ?? '0');
  if (length > maxBytes) fail(413, 'payload_too_large');
  const text = await c.req.text();
  if (text.length > maxBytes) fail(413, 'payload_too_large');
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    fail(400, 'invalid_json');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    fail(400, 'invalid_input', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return parsed.data;
}

export function query<T extends z.ZodType>(c: AppContext, schema: T): z.infer<T> {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) fail(400, 'invalid_query');
  return parsed.data;
}

export function clientIp(c: AppContext): string | null {
  return c.req.header('CF-Connecting-IP') ?? null;
}

export async function clientIpHash(c: AppContext): Promise<string> {
  return (await ipKeyHash(c.env.IP_HASH_SECRET, clientIp(c))).hash;
}

export function sameOrigin(c: AppContext): boolean {
  const origin = c.req.header('Origin');
  const host = c.req.header('Host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function idParam(c: AppContext, name = 'id'): number {
  const value = Number(c.req.param(name));
  if (!Number.isInteger(value) || value <= 0) fail(400, 'invalid_id');
  return value;
}
