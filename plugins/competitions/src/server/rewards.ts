import { PlayerTaskError, type PlayerTask, type PluginContext } from '@outpost/plugin-api';
import { PLAYER_NAME_PATTERN, renderTemplate } from '@outpost/shared';
import { z } from 'zod';
import { renderReward } from '../render.js';
import { messagesSchema, type Messages } from '../shared.js';

/** The kind of the tasks that give rewards. */
export const REWARD_KIND = 'reward';

/** What a reward task carries: one command for one winner, frozen when the competition ended. */
export const rewardPayloadSchema = z.object({
  eventId: z.string(),
  eventName: z.string(),
  place: z.number().int(),
  score: z.number(),
  /** The position of the command among those of the place. */
  index: z.number().int(),
  command: z.string(),
  /** The message to the winner, told with the first command of the place. */
  message: messagesSchema.shape.reward.nullable(),
});
export type RewardPayload = z.infer<typeof rewardPayloadSchema>;

/**
 * Whether the reply of the server says that the command did not work. Minecraft answers commands
 * it cannot parse with the place of the mistake marked by `<--[HERE]`.
 */
export function commandFailure(reply: string): { retry: boolean; text: string } | null {
  const text = reply.replace(/§./g, '').trim();
  if (text.includes('<--[HERE]')) return { retry: false, text };
  if (/^No (?:player|entity) was found/i.test(text)) return { retry: true, text };
  return null;
}

/** The command of a reward for a winner, with the placeholders filled in. */
export function rewardCommand(
  command: string,
  winner: { name: string; uuid: string },
  payload: Pick<RewardPayload, 'eventName' | 'place' | 'score'>,
): string {
  return renderTemplate(command.replace(/^\/+/, ''), {
    player: winner.name,
    uuid: winner.uuid,
    place: String(payload.place),
    score: String(payload.score),
    event: payload.eventName,
  });
}

/** Gives the reward of a task: runs its command and tells the winner. */
export function createRewardHandler(ctx: PluginContext) {
  return async (task: PlayerTask): Promise<void> => {
    const payload = rewardPayloadSchema.parse(task.payload);
    // The name goes into a console command: only what can be the name of a player.
    if (!PLAYER_NAME_PATTERN.test(task.playerName)) {
      throw new PlayerTaskError(`"${task.playerName}" cannot be the name of a player`);
    }
    const reply = await ctx.commands.send(
      task.serverId,
      rewardCommand(payload.command, { name: task.playerName, uuid: task.playerUuid }, payload),
    );
    const failure = commandFailure(reply);
    if (failure !== null) {
      const message = `The server did not accept the command: ${failure.text.slice(0, 200)}`;
      throw failure.retry ? new Error(message) : new PlayerTaskError(message);
    }
    if (payload.message !== null) {
      const messages = { reward: payload.message } as Messages;
      const lines = renderReward(
        { name: payload.eventName, messages },
        { name: task.playerName, place: payload.place, score: payload.score },
      );
      try {
        for (const line of lines) await ctx.chat.tell(task.serverId, task.playerName, line);
      } catch (err) {
        // The reward is given; a message that did not arrive must not give it twice.
        ctx.logger.debug('telling the winner failed', { error: String(err) });
      }
    }
  };
}
