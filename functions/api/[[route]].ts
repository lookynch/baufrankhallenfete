import { handle } from 'hono/cloudflare-pages';
import { createApp } from '../../src/server/app.ts';

export const onRequest = handle(createApp());
