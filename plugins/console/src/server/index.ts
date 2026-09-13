import { definePlugin, PLUGIN_API_VERSION, type LogLine } from '@outpost/plugin-api';
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
  // Chat uses tellraw and replies are rendered with § codes: Minecraft only for now.
  games: ['minecraft-java'],
  permissions: [
    { key: ConsolePermission.execute, roles: ['owner', 'admin'] },
    { key: ConsolePermission.chat, roles: ['owner', 'admin', 'moderator'] },
    // The log shows the chat and the IP addresses of the players, so viewers do not see it.
    { key: ConsolePermission.read, roles: ['owner', 'admin', 'moderator'] },
  ],

  setup(ctx) {
    // The live log: the recent lines first, then new ones as the server writes them.
    ctx.http.serverEvents({
      url: '/log',
      permission: ConsolePermission.read,
      capability: 'logs.stream',
      open: async ({ server, send, lastEventId }) => {
        // A browser that reconnects gets only the lines it missed.
        let lastSent = lastEventId === undefined ? 0 : Number(lastEventId) || 0;
        const deliver = (lines: LogLine[]) => {
          const fresh = lines.filter((line) => line.id > lastSent);
          const last = fresh.at(-1);
          if (last === undefined) return;
          lastSent = last.id;
          send({ event: 'lines', id: String(last.id), data: fresh });
        };
        // Subscribing first and reading the recent lines right after loses no line in between.
        const stop = await ctx.logs.subscribe(server.id, deliver);
        deliver(await ctx.logs.recent(server.id));
        send({ event: 'ready', data: {} });
        return stop;
      },
    });

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
