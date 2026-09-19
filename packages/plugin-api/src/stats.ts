import type { PlayerStats } from '@outpost/shared';

export type { PlayerStats } from '@outpost/shared';

/** The file of statistics of one player. */
export interface StatsFile {
  /** Lowercase, with dashes. */
  uuid: string;
  /** When the game server wrote it last: at a leave, at an autosave and at `save-all`. */
  modifiedAt: Date;
}

/** Statistics of the players of a game server (capability `stats.read`). */
export interface PlayerStatistics {
  /** The players the server has statistics of. */
  list(serverId: string): Promise<StatsFile[]>;
  /** The counters of a player; null when there is no file or it has another format. */
  read(serverId: string, uuid: string): Promise<PlayerStats | null>;
  /**
   * Makes the game server write the statistics of everyone online now (`save-all flush`), so that
   * `read` is exact. Does nothing without the capability `commands.send`.
   */
  flush(serverId: string): Promise<void>;
}
