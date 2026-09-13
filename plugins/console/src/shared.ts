import { z } from 'zod';

export const CONSOLE_PLUGIN_ID = 'outpost.console';

export const ConsolePermission = {
  /** Run any console command. */
  execute: 'console.execute',
  /** Send chat messages to the players. */
  chat: 'chat.send',
  /** See the live log of the server. */
  read: 'console.read',
} as const;

/** Lines of the live log, as the `lines` events of the log stream carry them. */
export const logLinesSchema = z.array(z.object({ id: z.number(), text: z.string() }));

export const commandRequestSchema = z.object({
  /** Without the leading slash; one is removed if present. */
  command: z.string().trim().min(1).max(1446),
});

export const commandResultSchema = z.object({
  reply: z.string(),
});

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(256),
});

/**
 * The `tellraw` command that shows a chat message from the panel to all players. The text is
 * JSON-encoded, so nothing in it can change the command.
 */
export function chatCommand(username: string, message: string): string {
  const text = message.replace(/[\r\n]+/g, ' ');
  const components = [
    { text: '[Web] ', color: 'gray' },
    { text: `${username}: `, color: 'aqua' },
    { text },
  ];
  return `tellraw @a ${JSON.stringify(components)}`;
}
