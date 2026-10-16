import { Hono } from 'hono';
import { COVER_ID } from '../../shared/spotify.ts';
import { fail, type AppEnv } from '../http.ts';
import { fetchCover } from '../services/cover.ts';

export const coverRoutes = new Hono<AppEnv>();

coverRoutes.get('/:id', (c) => {
  const id = c.req.param('id');
  if (!COVER_ID.test(id)) fail(404, 'not_found');
  return fetchCover(id);
});
