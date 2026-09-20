import {
  API_PREFIX,
  CorePermission,
  serverModuleListSchema,
  serverModuleSchema,
  serverModuleUpdateSchema,
} from '@outpost/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import type { ServerModules } from '../modules/server-modules.js';
import type { ServerService } from '../servers/service.js';

/** The modules of a server, and switching them on and off. */
export function registerModuleRoutes(
  fastify: FastifyInstance,
  auth: AuthService,
  servers: ServerService,
  modules: ServerModules,
): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['servers'];
  const base = `${API_PREFIX}/servers/:serverId/modules`;
  const serverParams = z.object({ serverId: z.string() });
  const moduleParams = serverParams.extend({ pluginId: z.string() });

  app.get(
    base,
    { schema: { tags, params: serverParams, response: { 200: serverModuleListSchema } } },
    async (request) => {
      const { server } = await servers.require(
        request,
        request.params.serverId,
        CorePermission.view,
      );
      return {
        modules: modules.modulesOf(servers.gameOf(server)).map((plugin) => ({
          id: plugin.id,
          version: plugin.version,
          essential: plugin.essential,
          enabled: modules.isEnabled(server.id, plugin.id),
        })),
      };
    },
  );

  app.put(
    `${base}/:pluginId`,
    {
      schema: {
        tags,
        params: moduleParams,
        body: serverModuleUpdateSchema,
        response: { 200: serverModuleSchema },
      },
    },
    async (request) => {
      const { serverId, pluginId } = request.params;
      const { server, ctx } = await servers.require(request, serverId, CorePermission.manage);
      const { enabled } = request.body;
      const plugin = await modules.set(
        { id: server.id, game: servers.gameOf(server) },
        pluginId,
        enabled,
        ctx.user.id,
      );
      await auth.audit.record({
        action: enabled ? 'server.module_enabled' : 'server.module_disabled',
        userId: ctx.user.id,
        serverId: server.id,
        target: plugin.id,
        ip: request.ip,
      });
      return { id: plugin.id, version: plugin.version, essential: plugin.essential, enabled };
    },
  );
}
