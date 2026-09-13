import { HttpError } from '@outpost/plugin-api';
import {
  API_PREFIX,
  filesInputSchema,
  filesStateSchema,
  filesTestResultSchema,
} from '@outpost/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { testFolder } from '../files/folder.js';
import type { ServerService } from '../servers/service.js';

/**
 * The Files connector of a server: its folder below the files root. Saving tests the folder first
 * and refuses one that fails, so that a server offers `files.write` only where writing works.
 */
export function registerFilesRoutes(
  fastify: FastifyInstance,
  auth: AuthService,
  servers: ServerService,
  root: string,
): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['servers'];
  const url = `${API_PREFIX}/servers/:serverId/files`;
  const params = z.object({ serverId: z.string() });

  app.get(
    url,
    { schema: { tags, params, response: { 200: filesStateSchema } } },
    async (request) => {
      const { server } = await servers.requireConnectorAdmin(request, request.params.serverId);
      return { root, files: servers.filesInfo(server) };
    },
  );

  app.put(url, { schema: { tags, params, body: filesInputSchema } }, async (request, reply) => {
    const { server, ctx } = await servers.requireConnectorAdmin(request, request.params.serverId, {
      sudo: true,
    });
    const { source, path, writable } = request.body;
    const result = await testFolder(root, path, writable);
    if (!result.ok) {
      throw new HttpError(400, 'files_test_failed', 'The folder did not pass the test', result);
    }
    await servers.saveFiles(server.id, request.body);
    await auth.audit.record({
      action: 'server.files_updated',
      userId: ctx.user.id,
      serverId: server.id,
      ip: request.ip,
      details: { source, path, writable },
    });
    return reply.code(204).send();
  });

  app.delete(url, { schema: { tags, params } }, async (request, reply) => {
    const { server, ctx } = await servers.requireConnectorAdmin(request, request.params.serverId, {
      sudo: true,
    });
    await servers.removeFiles(server.id);
    await auth.audit.record({
      action: 'server.files_removed',
      userId: ctx.user.id,
      serverId: server.id,
      ip: request.ip,
    });
    return reply.code(204).send();
  });

  app.post(
    `${url}/test`,
    {
      schema: { tags, params, body: filesInputSchema, response: { 200: filesTestResultSchema } },
    },
    async (request) => {
      await servers.requireConnectorAdmin(request, request.params.serverId);
      return testFolder(root, request.body.path, request.body.writable);
    },
  );
}
