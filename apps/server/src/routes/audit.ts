import {
  API_PREFIX,
  auditPageSchema,
  globalAuditQuerySchema,
  roleListSchema,
  ROLE_KEYS,
} from '@outpost/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AuthService } from '../auth/service.js';
import { ROLE_RANK, type PermissionRegistry } from '../rbac/permissions.js';
import { cleanFilter } from './servers.js';

/** The instance-wide audit log (superadmins) and the server roles with their permissions. */
export function registerAuditRoutes(
  fastify: FastifyInstance,
  auth: AuthService,
  registry: PermissionRegistry,
): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    `${API_PREFIX}/audit`,
    {
      schema: {
        tags: ['admin'],
        querystring: globalAuditQuerySchema,
        response: { 200: auditPageSchema },
      },
    },
    async (request) => {
      auth.requireSuperadmin(request);
      return auth.audit.page(cleanFilter(request.query));
    },
  );

  app.get(
    `${API_PREFIX}/roles`,
    { schema: { tags: ['servers'], response: { 200: roleListSchema } } },
    async (request) => {
      auth.requireUser(request);
      return {
        roles: ROLE_KEYS.map((key) => ({
          key,
          rank: ROLE_RANK[key],
          permissions: [...registry.forRole(key)].sort(),
        })),
      };
    },
  );
}
