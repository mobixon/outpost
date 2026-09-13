import { sql, type Kysely } from '@outpost/plugin-api';
import type { HistoryEntry } from '../shared.js';
import type { ConsoleTables } from './tables.js';

/** Commands kept per user and server; older ones are forgotten. */
export const HISTORY_SIZE = 100;

/** The commands each user ran on each server, to pick them again in the console. */
export class CommandHistory {
  constructor(private readonly db: Kysely<ConsoleTables>) {}

  /** Remembers a command; one run before moves to the top instead of appearing twice. */
  async record(serverId: string, userId: string, command: string): Promise<void> {
    const now = Date.now();
    const updated = await this.db
      .updateTable('console_history')
      .set({ used_at: now, uses: sql<number>`uses + 1` })
      .where('server_id', '=', serverId)
      .where('user_id', '=', userId)
      .where('command', '=', command)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 0) {
      await this.db
        .insertInto('console_history')
        .values({
          id: crypto.randomUUID(),
          server_id: serverId,
          user_id: userId,
          command,
          uses: 1,
          used_at: now,
        })
        // The same command sent twice at once: the other request stored it already.
        .onConflict((conflict) => conflict.doNothing())
        .execute();
    }
    const newest = this.db
      .selectFrom('console_history')
      .select('id')
      .where('server_id', '=', serverId)
      .where('user_id', '=', userId)
      .orderBy('used_at', 'desc')
      .limit(HISTORY_SIZE);
    await this.db
      .deleteFrom('console_history')
      .where('server_id', '=', serverId)
      .where('user_id', '=', userId)
      .where('id', 'not in', newest)
      .execute();
  }

  /** The history of a user on a server, the last used command first. */
  async list(serverId: string, userId: string): Promise<HistoryEntry[]> {
    const rows = await this.db
      .selectFrom('console_history')
      .select(['id', 'command', 'uses', 'used_at'])
      .where('server_id', '=', serverId)
      .where('user_id', '=', userId)
      .orderBy('used_at', 'desc')
      .limit(HISTORY_SIZE)
      .execute();
    return rows.map((row) => ({
      id: row.id,
      command: row.command,
      uses: Number(row.uses),
      usedAt: new Date(Number(row.used_at)).toISOString(),
    }));
  }

  /** Forgets one command of the history, or all of them; answers how many. */
  async remove(serverId: string, userId: string, id?: string): Promise<number> {
    let query = this.db
      .deleteFrom('console_history')
      .where('server_id', '=', serverId)
      .where('user_id', '=', userId);
    if (id !== undefined) query = query.where('id', '=', id);
    const result = await query.executeTakeFirst();
    return Number(result.numDeletedRows);
  }
}
