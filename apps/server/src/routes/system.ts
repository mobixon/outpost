import { API_PREFIX, healthSchema, pluginListSchema, readinessSchema } from '@outpost/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { PluginHost } from '../plugins/host.js';

export interface SystemRouteDeps {
  plugins: PluginHost;
  /** Throws the 401/403 answer unless a user with a complete login made the request. */
  requireUser(request: FastifyRequest): unknown;
  checkDatabase(): Promise<boolean>;
}

export function registerSystemRoutes(fastify: FastifyInstance, deps: SystemRouteDeps): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Liveness: the process answers. Used by container health checks.
  app.get(
    '/healthz',
    { schema: { tags: ['system'], response: { 200: healthSchema } } },
    async () => ({ status: 'ok' as const }),
  );

  // Readiness: the database is reachable and all plugins are set up.
  app.get(
    '/readyz',
    { schema: { tags: ['system'], response: { 200: readinessSchema, 503: readinessSchema } } },
    async (_request, reply) => {
      const checks = { database: await deps.checkDatabase(), plugins: deps.plugins.started };
      const ready = Object.values(checks).every(Boolean);
      return reply.code(ready ? 200 : 503).send({ status: ready ? 'ready' : 'not_ready', checks });
    },
  );

  app.get(
    `${API_PREFIX}/plugins`,
    { schema: { tags: ['system'], response: { 200: pluginListSchema } } },
    async (request) => {
      deps.requireUser(request);
      return { plugins: deps.plugins.list() };
    },
  );

  app.get(`${API_PREFIX}/openapi.json`, { schema: { hide: true } }, async () => fastify.swagger());
}
