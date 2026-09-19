import { HttpError, type PluginContext } from '@outpost/plugin-api';
import { PLAYER_NAME_PATTERN, tellrawCommand } from '@outpost/shared';

/** Minecraft reads RCON requests with at most 1446 bytes of command. */
const MAX_COMMAND_BYTES = 1446;

/** Messages to players of Minecraft servers, through the console: `tellraw` with JSON built here. */
export function createChat(
  send: (serverId: string, command: string) => Promise<string>,
  hasCapability: (serverId: string) => Promise<boolean>,
): PluginContext['chat'] {
  async function run(serverId: string, target: string, message: string): Promise<void> {
    if (!(await hasCapability(serverId))) {
      throw new HttpError(409, 'capability_missing', 'The server cannot send chat messages');
    }
    const command = tellrawCommand(target, message);
    if (new TextEncoder().encode(command).length > MAX_COMMAND_BYTES) {
      throw new HttpError(400, 'message_too_long', 'The message is too long');
    }
    await send(serverId, command);
  }
  return {
    tell: async (serverId, player, message) => {
      if (!PLAYER_NAME_PATTERN.test(player)) {
        throw new HttpError(400, 'invalid_player', 'This is not the name of a player');
      }
      await run(serverId, player, message);
    },
    broadcast: (serverId, message) => run(serverId, '@a', message),
  };
}
