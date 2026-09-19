import type { GameLogEvent } from '@outpost/shared';

/**
 * What a player did on a game server, as its log tells (capability `game.events`): a chat message,
 * a join or a leave.
 */
export type GameEvent = GameLogEvent;

export interface GameEvents {
  /**
   * Calls `listener` with the events as the server writes them, from now on; resolves with a
   * function that stops. The log of the server is followed while somebody listens, and again
   * after its Files connector changed. Throws an HttpError 409 without the capability.
   */
  subscribe(serverId: string, listener: (event: GameEvent) => void): Promise<() => void>;
}
