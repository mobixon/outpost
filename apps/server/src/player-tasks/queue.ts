import { randomUUID } from 'node:crypto';
import {
  HttpError,
  PlayerTaskError,
  type NewPlayerTask,
  type PlayerTask,
  type PlayerTasks,
  type PlayerTaskStatus,
} from '@outpost/plugin-api';
import { normalizeUuid, parsePlayerList, PLAYER_NAME_PATTERN } from '@outpost/shared';
import type { Kysely } from 'kysely';
import type { CoreTables, PlayerTasksTable } from '../db/schema.js';

type Handler = (task: PlayerTask) => void | Promise<void>;

/** A task that failed this many times is given up. */
const MAX_ATTEMPTS = 5;
/** After a failure a task waits this long times the number of failures. */
const RETRY_DELAY_MS = 30_000;
/** Finished tasks are kept this long. */
const KEEP_MS = 365 * 24 * 60 * 60_000;
const ERROR_LIMIT = 500;
const PRUNE_INTERVAL_MS = 60 * 60_000;

const toTask = (row: PlayerTasksTable): PlayerTask => ({
  id: row.id,
  serverId: row.server_id,
  playerUuid: row.player_uuid,
  playerName: row.player_name,
  kind: row.kind,
  payload: JSON.parse(row.payload) as unknown,
  status: row.status,
  attempts: Number(row.attempts),
  error: row.error,
  createdAt: new Date(Number(row.created_at)),
  updatedAt: new Date(Number(row.updated_at)),
});

export interface PlayerTaskQueueOptions {
  db: Kysely<CoreTables>;
  /** Runs a console command of the server and returns its reply. */
  send(serverId: string, command: string): Promise<string>;
  /** Whether the server can tell who is online (`players.whenOnline`). */
  canTell(serverId: string): Promise<boolean>;
  onError?(err: unknown, context: Record<string, unknown>): void;
}

/**
 * The tasks plugins want done when a player is online. Every few seconds the queue asks the servers
 * that have pending tasks who is online (`list`) and runs the tasks of those players, and it runs
 * a player's tasks at once when a plugin says the player has joined. Tasks are in the database, so
 * they wait through restarts of Outpost.
 */
export class PlayerTaskQueue {
  readonly #handlers = new Map<string, Handler>();
  readonly #running = new Set<string>();
  #timer: NodeJS.Timeout | undefined;
  #sweeping = false;
  #prunedAt = 0;

  constructor(private readonly options: PlayerTaskQueueOptions) {}

  /** Starts looking for online players every `intervalMs`. */
  start(intervalMs = 10_000): void {
    this.#timer = setInterval(() => void this.sweep(), intervalMs);
    this.#timer.unref();
  }

  stop(): void {
    clearInterval(this.#timer);
  }

  /** The queue as one plugin sees it: only its own tasks and handlers. */
  forPlugin(pluginId: string, inSetup: () => boolean): PlayerTasks {
    const { db } = this.options;
    const own = () => db.selectFrom('player_tasks').where('plugin_id', '=', pluginId);
    return {
      handle: (kind, handler) => {
        if (!inSetup()) {
          throw new Error(`Plugin "${pluginId}" can register task handlers only during setup`);
        }
        const key = `${pluginId}\n${kind}`;
        if (this.#handlers.has(key)) {
          throw new Error(`Plugin "${pluginId}" handles the task kind "${kind}" twice`);
        }
        this.#handlers.set(key, handler);
      },

      enqueue: async (task: NewPlayerTask) => {
        const uuid = normalizeUuid(task.playerUuid);
        if (uuid === null || !PLAYER_NAME_PATTERN.test(task.playerName)) {
          throw new HttpError(400, 'invalid_player', 'This is not a player');
        }
        const now = Date.now();
        const row: PlayerTasksTable = {
          id: randomUUID(),
          plugin_id: pluginId,
          server_id: task.serverId,
          player_uuid: uuid,
          player_name: task.playerName,
          kind: task.kind,
          payload: JSON.stringify(task.payload),
          status: 'pending',
          attempts: 0,
          error: null,
          retry_at: 0,
          created_at: now,
          updated_at: now,
        };
        await db.insertInto('player_tasks').values(row).execute();
        return toTask(row);
      },

      list: async ({ serverId, kind, status }) => {
        let query = own().selectAll().where('server_id', '=', serverId);
        if (kind !== undefined) query = query.where('kind', '=', kind);
        if (status !== undefined) query = query.where('status', '=', status);
        const rows = await query.orderBy('created_at', 'desc').orderBy('id').execute();
        return rows.map(toTask);
      },

      retry: async (id) => {
        const result = await db
          .updateTable('player_tasks')
          .set({ status: 'pending', attempts: 0, error: null, retry_at: 0, updated_at: Date.now() })
          .where('id', '=', id)
          .where('plugin_id', '=', pluginId)
          .where('status', '=', 'failed')
          .executeTakeFirst();
        return Number(result.numUpdatedRows) > 0;
      },

      cancel: async (id) => {
        const result = await db
          .updateTable('player_tasks')
          .set({ status: 'cancelled', updated_at: Date.now() })
          .where('id', '=', id)
          .where('plugin_id', '=', pluginId)
          .where('status', 'in', ['pending', 'failed'])
          .executeTakeFirst();
        return Number(result.numUpdatedRows) > 0;
      },

      playerJoined: (serverId, playerName) => {
        void this.#runFor(serverId, new Set([playerName.toLowerCase()])).catch((err: unknown) => {
          this.options.onError?.(err, { serverId, playerName });
        });
      },
    };
  }

  /** One look at who is online on the servers that have tasks to do. */
  async sweep(): Promise<void> {
    if (this.#sweeping) return;
    this.#sweeping = true;
    try {
      const due = await this.options.db
        .selectFrom('player_tasks')
        .select('server_id')
        .distinct()
        .where('status', '=', 'pending')
        .where('retry_at', '<=', Date.now())
        .execute();
      for (const { server_id: serverId } of due) {
        try {
          if (!(await this.options.canTell(serverId))) continue;
          const list = parsePlayerList(await this.options.send(serverId, 'list'));
          if (list === null || list.names.length === 0) continue;
          await this.#runFor(serverId, new Set(list.names.map((name) => name.toLowerCase())));
        } catch (err) {
          this.options.onError?.(err, { serverId });
        }
      }
      await this.#prune();
    } finally {
      this.#sweeping = false;
    }
  }

  /** Runs the due tasks of the players (lowercase names) who are online on a server. */
  async #runFor(serverId: string, online: ReadonlySet<string>): Promise<void> {
    const rows = await this.options.db
      .selectFrom('player_tasks')
      .selectAll()
      .where('server_id', '=', serverId)
      .where('status', '=', 'pending')
      .where('retry_at', '<=', Date.now())
      .orderBy('created_at')
      .orderBy('id')
      .execute();
    for (const row of rows) {
      if (!online.has(row.player_name.toLowerCase()) || this.#running.has(row.id)) continue;
      const handler = this.#handlers.get(`${row.plugin_id}\n${row.kind}`);
      // The plugin is not enabled: the task waits for it.
      if (handler === undefined) continue;
      this.#running.add(row.id);
      try {
        await this.#run(row, handler);
      } finally {
        this.#running.delete(row.id);
      }
    }
  }

  async #run(row: PlayerTasksTable, handler: Handler): Promise<void> {
    const { db } = this.options;
    const finish = async (changes: Partial<PlayerTasksTable>) => {
      // A task cancelled while it ran stays cancelled.
      await db
        .updateTable('player_tasks')
        .set({ ...changes, updated_at: Date.now() })
        .where('id', '=', row.id)
        .where('status', '=', 'pending')
        .execute();
    };
    try {
      await handler(toTask(row));
      await finish({ status: 'done', error: null });
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, ERROR_LIMIT);
      const attempts = Number(row.attempts) + 1;
      const fatal = err instanceof PlayerTaskError || attempts >= MAX_ATTEMPTS;
      await finish({
        status: fatal ? 'failed' : 'pending',
        attempts,
        error: message,
        retry_at: Date.now() + RETRY_DELAY_MS * attempts,
      });
      this.options.onError?.(err, { taskId: row.id, kind: row.kind, plugin: row.plugin_id });
    }
  }

  async #prune(): Promise<void> {
    if (Date.now() - this.#prunedAt < PRUNE_INTERVAL_MS) return;
    this.#prunedAt = Date.now();
    const finished: PlayerTaskStatus[] = ['done', 'failed', 'cancelled'];
    await this.options.db
      .deleteFrom('player_tasks')
      .where('status', 'in', finished)
      .where('updated_at', '<', Date.now() - KEEP_MS)
      .execute();
  }
}
