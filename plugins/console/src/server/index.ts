import { definePlugin, PLUGIN_API_VERSION } from '@outpost/plugin-api';
import {
  chatCommand,
  chatRequestSchema,
  commandRequestSchema,
  commandResultSchema,
  CONSOLE_PLUGIN_ID,
  ConsolePermission,
} from '../shared.js';

export default definePlugin({
  id: CONSOLE_PLUGIN_ID,
  version: '0.1.0',
  apiVersion: PLUGIN_API_VERSION,
  permissions: [
    { key: ConsolePermission.execute, roles: ['owner', 'admin'] },
    { key: ConsolePermission.chat, roles: ['owner', 'admin', 'moderator'] },
  ],

  setup(ctx) {
    ctx.http.serverRoute({
      method: 'POST',
      url: '/command',
      permission: ConsolePermission.execute,
      capability: 'commands.send',
      schema: { body: commandRequestSchema, response: commandResultSchema },
      handler: async ({ server, user, body, ip }) => {
        const command = body.command.replace(/^\//, '');
        let ok = false;
        try {
          const reply = await ctx.commands.send(server.id, command);
          ok = true;
          return { reply };
        } finally {
          // Every command is recorded, also the ones that failed.
          await ctx.audit.record({
            action: 'command',
            userId: user.id,
            serverId: server.id,
            ip,
            details: { command, ok },
          });
        }
      },
    });

    ctx.http.serverRoute({
      method: 'POST',
      url: '/chat',
      permission: ConsolePermission.chat,
      capability: 'commands.send',
      schema: { body: chatRequestSchema },
      handler: async ({ server, user, body, ip }) => {
        await ctx.commands.send(server.id, chatCommand(user.username, body.message));
        await ctx.audit.record({
          action: 'chat',
          userId: user.id,
          serverId: server.id,
          ip,
          details: { message: body.message },
        });
        return { sent: true };
      },
    });
  },
});
