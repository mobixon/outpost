/** Where a task of a player is. */
export type PlayerTaskStatus = 'pending' | 'done' | 'failed' | 'cancelled';

/** Something to do when a player is online, kept in the database until it is done. */
export interface PlayerTask {
  id: string;
  serverId: string;
  playerUuid: string;
  playerName: string;
  /** The kind the plugin registered a handler for. */
  kind: string;
  /** What the plugin gave when it added the task. */
  payload: unknown;
  status: PlayerTaskStatus;
  /** How many times the handler failed. */
  attempts: number;
  /** The last failure. */
  error: string | null;
  createdAt: Date;
  /** When the status last changed. */
  updatedAt: Date;
}

/** Thrown by a handler for a failure that another attempt would not fix. */
export class PlayerTaskError extends Error {
  override name = 'PlayerTaskError';
}

export interface NewPlayerTask {
  serverId: string;
  playerUuid: string;
  playerName: string;
  kind: string;
  /** Any JSON-serializable value. */
  payload: unknown;
}

export interface PlayerTasks {
  /**
   * Registers what to do for tasks of a kind, once, during `setup`. The handler runs when the
   * player is online: it is done when it returns, tried again a little later when it throws, and
   * failed for good after five attempts or when it throws a `PlayerTaskError`.
   */
  handle(kind: string, handler: (task: PlayerTask) => void | Promise<void>): void;
  /** Adds a task; it runs as soon as the player is online (within about 10 seconds). */
  enqueue(task: NewPlayerTask): Promise<PlayerTask>;
  /** The tasks of the plugin on a server, newest first. */
  list(query: {
    serverId: string;
    kind?: string;
    status?: PlayerTaskStatus;
  }): Promise<PlayerTask[]>;
  /** Makes a failed task pending again; false when there is no such task or it did not fail. */
  retry(id: string): Promise<boolean>;
  /** Cancels a pending or failed task; false when there is no such task or it is over. */
  cancel(id: string): Promise<boolean>;
  /**
   * Runs the pending tasks of a player who has just joined, without waiting for the next look
   * at who is online. Never throws; the tasks report their own outcome.
   */
  playerJoined(serverId: string, playerName: string): void;
}
