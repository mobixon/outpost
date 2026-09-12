import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ConfigError } from '../config.js';

const CACHE_FOREVER = 'public, max-age=31536000, immutable';

/**
 * Serves the built web UI. Vite puts content-hashed files under `assets/`, so those are cached
 * forever; everything else (index.html) is revalidated on every load.
 */
export async function registerWebUi(app: FastifyInstance, webDir: string): Promise<void> {
  const root = resolve(webDir);
  if (!existsSync(join(root, 'index.html'))) {
    throw new ConfigError(`OUTPOST_WEB_DIR: ${root} does not contain index.html`);
  }
  await app.register(fastifyStatic, {
    root,
    cacheControl: false,
    setHeaders: (reply, filePath) => {
      const immutable = filePath.includes(`${sep}assets${sep}`);
      reply.header('cache-control', immutable ? CACHE_FOREVER : 'no-cache');
    },
  });
}

/** Whether the request is a browser navigation to a client-side route that needs index.html. */
export function isClientRoute(request: FastifyRequest): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const path = request.url.split('?', 1)[0] ?? '';
  if (path === '/api' || path.startsWith('/api/')) return false;
  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  return !lastSegment.includes('.');
}
