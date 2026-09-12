import { HttpError } from '@outpost/plugin-api';
import {
  API_PREFIX,
  connectionStateSchema,
  connectionTestResultSchema,
  CorePermission,
  rconConnectionInputSchema,
  serverStatusSchema,
} from '@outpost/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { testConnection, type ConnectionManager } from '../connections/manager.js';
import type { ServerService } from '../servers/service.js';

/** How Outpost reaches a server (RCON in this version), a connection test and the status. */
export function registerConnectionRoutes(
  fastify: FastifyInstance,
  auth: AuthService,
  servers: ServerService,
  connections: ConnectionManager,
): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['servers'];
  const base = `${API_PREFIX}/servers/:serverId`;
  const params = z.object({ serverId: z.string() });

  /**
   * Connections are managed by superadmins: a connection points Outpost at a host and port in
   * its network, which should not be up to the members of a server.
   */
  async function requireConnectionAdmin(request: FastifyRequest, serverId: string, sudo = false) {
    const access = await servers.require(request, serverId, CorePermission.manage);
    if (access.actor !== 'superadmin') {
      throw new HttpError(403, 'forbidden', 'Only superadmins can change the connection');
    }
    if (sudo) auth.assertSudo(access.ctx);
    return access;
  }

  app.get(
    `${base}/connection`,
    { schema: { tags, params, response: { 200: connectionStateSchema } } },
    async (request) => {
      const { server } = await requireConnectionAdmin(request, request.params.serverId);
      return { connection: servers.connectionInfo(server) };
    },
  );

  app.put(
    `${base}/connection`,
    { schema: { tags, params, body: rconConnectionInputSchema } },
    async (request, reply) => {
      const { server, ctx } = await requireConnectionAdmin(request, request.params.serverId, true);
      const { game, host, port, password } = request.body;
      await servers.saveConnection(server, { game, host, port, password });
      connections.reset(server.id);
      await auth.audit.record({
        action: 'server.connection_updated',
        userId: ctx.user.id,
        serverId: server.id,
        ip: request.ip,
        details: { type: 'rcon', game, host, port, passwordChanged: password !== undefined },
      });
      return reply.code(204).send();
    },
  );

  app.delete(`${base}/connection`, { schema: { tags, params } }, async (request, reply) => {
    const { server, ctx } = await requireConnectionAdmin(request, request.params.serverId, true);
    await servers.removeConnection(server.id);
    connections.reset(server.id);
    await auth.audit.record({
      action: 'server.connection_removed',
      userId: ctx.user.id,
      serverId: server.id,
      ip: request.ip,
    });
    return reply.code(204).send();
  });

  // Tries the entered settings (or the stored password) without saving them.
  app.post(
    `${base}/connection/test`,
    {
      schema: {
        tags,
        params,
        body: rconConnectionInputSchema,
        response: { 200: connectionTestResultSchema },
      },
    },
    async (request) => {
      const { server } = await requireConnectionAdmin(request, request.params.serverId);
      const { host, port } = request.body;
      const stored = servers.connectionOf(server);
      const password =
        request.body.password ?? (stored === null ? undefined : servers.openPassword(stored));
      if (password === undefined) {
        throw new HttpError(400, 'rcon_password_required', 'Enter the RCON password');
      }
      return testConnection({ host, port, password });
    },
  );

  app.get(
    `${base}/status`,
    { schema: { tags, params, response: { 200: serverStatusSchema } } },
    async (request) => {
      const { server } = await servers.require(
        request,
        request.params.serverId,
        CorePermission.view,
      );
      return connections.status(server.id);
    },
  );
}
