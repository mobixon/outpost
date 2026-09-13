import { HttpError } from '@outpost/plugin-api';
import {
  API_PREFIX,
  filesInputSchema,
  filesStateSchema,
  filesTestResultSchema,
  gameDefaults,
  type FilesInput,
  type FilesTestResult,
} from '@outpost/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { testFolder } from '../files/folder.js';
import { testSftp, type SftpSessions, type SftpTarget } from '../files/sftp.js';
import type { LogHub } from '../logs/hub.js';
import type { ServerRow, ServerService } from '../servers/service.js';

/** What the audit log keeps of the Files connector: no passwords or keys. */
function auditDetails(input: FilesInput, sftp: SftpTarget | undefined): Record<string, unknown> {
  if (input.source === 'folder') {
    return { source: input.source, path: input.path, writable: input.writable };
  }
  return {
    source: input.source,
    host: input.host,
    port: input.port,
    username: input.username,
    auth: input.auth,
    path: input.path,
    writable: input.writable,
    hostKey: sftp?.hostKey,
    secretChanged: input.secret !== undefined,
  };
}

/**
 * The Files connector of a server: a folder below the files root, or an SFTP server. Saving tests
 * the settings first and refuses them when a step fails, so that a server offers `files.write`
 * only where writing works. SFTP pins the host key that the admin confirmed after a test.
 */
export function registerFilesRoutes(
  fastify: FastifyInstance,
  auth: AuthService,
  servers: ServerService,
  root: string,
  sessions: SftpSessions,
  logs: LogHub,
): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['servers'];
  const url = `${API_PREFIX}/servers/:serverId/files`;
  const params = z.object({ serverId: z.string() });
  /** The file every server of the game has in its data folder; the test looks for it. */
  const dataFileOf = (server: ServerRow) => gameDefaults(servers.gameOf(server))?.dataFile ?? null;

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
    const input = request.body;
    const dataFile = dataFileOf(server);
    let result: FilesTestResult;
    let sftp: SftpTarget | undefined;
    if (input.source === 'folder') {
      result = await testFolder(root, input.path, input.writable, dataFile);
    } else {
      sftp = servers.sftpTarget(server, input);
      if (sftp.hostKey === undefined) {
        throw new HttpError(
          400,
          'host_key_required',
          'Test the connection and confirm the host key',
        );
      }
      result = await testSftp(sftp, input.writable, dataFile);
    }
    if (!result.ok) {
      throw new HttpError(400, 'files_test_failed', 'The files did not pass the test', result);
    }
    await servers.saveFiles(server.id, input, sftp);
    sessions.reset(server.id);
    logs.reset(server.id);
    await auth.audit.record({
      action: 'server.files_updated',
      userId: ctx.user.id,
      serverId: server.id,
      ip: request.ip,
      details: auditDetails(input, sftp),
    });
    return reply.code(204).send();
  });

  app.delete(url, { schema: { tags, params } }, async (request, reply) => {
    const { server, ctx } = await servers.requireConnectorAdmin(request, request.params.serverId, {
      sudo: true,
    });
    await servers.removeFiles(server.id);
    sessions.reset(server.id);
    logs.reset(server.id);
    await auth.audit.record({
      action: 'server.files_removed',
      userId: ctx.user.id,
      serverId: server.id,
      ip: request.ip,
    });
    return reply.code(204).send();
  });

  // Tries the entered settings without saving them. For the same SFTP host the pinned key is
  // checked, so that a changed key shows up here.
  app.post(
    `${url}/test`,
    {
      schema: { tags, params, body: filesInputSchema, response: { 200: filesTestResultSchema } },
    },
    async (request) => {
      const { server } = await servers.requireConnectorAdmin(request, request.params.serverId);
      const input = request.body;
      const dataFile = dataFileOf(server);
      return input.source === 'folder'
        ? testFolder(root, input.path, input.writable, dataFile)
        : testSftp(servers.sftpTarget(server, input), input.writable, dataFile);
    },
  );
}
