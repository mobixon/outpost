import { HttpError, sql, type Kysely, type PluginContext } from '@outpost/plugin-api';
import { parsePlayerList, uuidMode, type PlayerList } from '@outpost/shared';
import { z } from 'zod';
import { serverModeSchema, type ServerMode } from '../shared.js';
import type { PlayersTables } from './tables.js';

/** Finished sessions are kept this long. */
const SESSION_RETENTION_MS = 180 * 24 * 60 * 60_000;

const modeStateSchema = z.object({
  detected: serverModeSchema.nullable(),
  override: serverModeSchema.nullable(),
});
export type ModeState = z.infer<typeof modeStateSchema> & { effective: ServerMode | null };

/**
 * Follows who is online: every poll runs `list uuids` and records joins and leaves, so the times
 * are exact to the poll interval. Also applies pending actions when their player shows up.
 */
export class PlayerTracker {
  readonly #queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly ctx: PluginContext,
    private readonly db: Kysely<PlayersTables>,
  ) {}

  /** Asks the server who is online and records the changes; one poll per server at a time. */
  poll(serverId: string): Promise<PlayerList> {
    const previous = this.#queues.get(serverId) ?? Promise.resolve();
    const run = previous.then(() => this.#poll(serverId));
    this.#queues.set(
      serverId,
      run.catch(() => undefined),
    );
    return run;
  }

  async #poll(serverId: string): Promise<PlayerList> {
    const list = parsePlayerList(await this.ctx.commands.send(serverId, 'list uuids'));
    if (list === null) {
      throw new HttpError(502, 'unexpected_reply', 'The server answered in an unknown format');
    }
    await this.#record(serverId, list, Date.now());
    return list;
  }

  async #record(serverId: string, list: PlayerList, now: number): Promise<void> {
    const online = list.players.flatMap((player) =>
      player.uuid === null ? [] : [{ name: player.name, uuid: player.uuid }],
    );
    const detected = online.map((player) => uuidMode(player.uuid)).find((mode) => mode !== null);
    if (detected !== undefined) await this.#setDetected(serverId, detected);

    const open = await this.db
      .selectFrom('mc_player_sessions')
      .selectAll()
      .where('server_id', '=', serverId)
      .where('left_at', 'is', null)
      .execute();
    const openUuids = new Set(open.map((session) => session.uuid));
    for (const player of online) {
      await this.db
        .insertInto('mc_players')
        .values({
          server_id: serverId,
          uuid: player.uuid,
          name: player.name,
          first_seen: now,
          last_seen: now,
          playtime_ms: 0,
        })
        .onConflict((conflict) =>
          conflict
            .columns(['server_id', 'uuid'])
            .doUpdateSet({ name: player.name, last_seen: now }),
        )
        .execute();
      if (!openUuids.has(player.uuid)) {
        await this.db
          .insertInto('mc_player_sessions')
          .values({
            id: crypto.randomUUID(),
            server_id: serverId,
            uuid: player.uuid,
            joined_at: now,
            left_at: null,
          })
          .execute();
      }
    }

    // Players gone since the last poll left when they were last seen.
    const onlineUuids = new Set(online.map((player) => player.uuid));
    for (const session of open) {
      if (onlineUuids.has(session.uuid)) continue;
      const player = await this.db
        .selectFrom('mc_players')
        .select('last_seen')
        .where('server_id', '=', serverId)
        .where('uuid', '=', session.uuid)
        .executeTakeFirst();
      const leftAt = Math.max(session.joined_at, Number(player?.last_seen ?? session.joined_at));
      await this.db
        .updateTable('mc_player_sessions')
        .set({ left_at: leftAt })
        .where('id', '=', session.id)
        .execute();
      await this.db
        .updateTable('mc_players')
        .set({ playtime_ms: sql<number>`playtime_ms + ${leftAt - session.joined_at}` })
        .where('server_id', '=', serverId)
        .where('uuid', '=', session.uuid)
        .execute();
    }

    await this.#applyPending(serverId, online);
  }

  async #applyPending(serverId: string, online: readonly { name: string }[]): Promise<void> {
    if (online.length === 0) return;
    const pending = await this.db
      .selectFrom('mc_pending_actions')
      .selectAll()
      .where('server_id', '=', serverId)
      .execute();
    for (const action of pending) {
      const player = online.find((entry) => entry.name.toLowerCase() === action.name.toLowerCase());
      if (player === undefined) continue;
      await this.apply(serverId, action, player.name);
    }
  }

  /** Runs a pending action now and removes it. */
  async apply(
    serverId: string,
    action: PlayersTables['mc_pending_actions'],
    name = action.name,
  ): Promise<string> {
    const command =
      action.action === 'ban'
        ? `ban ${name}${action.reason === null ? '' : ` ${action.reason}`}`
        : `op ${name}`;
    const reply = await this.ctx.commands.send(serverId, command);
    await this.db.deleteFrom('mc_pending_actions').where('id', '=', action.id).execute();
    await this.ctx.audit.record({
      action: 'pending_applied',
      serverId,
      target: name,
      details: { action: action.action },
      ...(action.created_by !== null && { userId: action.created_by }),
    });
    return reply;
  }

  async mode(serverId: string): Promise<ModeState> {
    const state = modeStateSchema
      .catch({ detected: null, override: null })
      .parse(await this.ctx.kv.get(`mode:${serverId}`));
    return { ...state, effective: state.override ?? state.detected };
  }

  async setOverride(serverId: string, override: ServerMode | null): Promise<void> {
    const { detected } = await this.mode(serverId);
    await this.ctx.kv.set(`mode:${serverId}`, { detected, override });
  }

  async #setDetected(serverId: string, detected: ServerMode): Promise<void> {
    const state = await this.mode(serverId);
    if (state.detected === detected) return;
    await this.ctx.kv.set(`mode:${serverId}`, { detected, override: state.override });
  }

  /** Whether the player has been seen online on the server. */
  async seen(serverId: string, name: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('mc_players')
      .select('uuid')
      .where('server_id', '=', serverId)
      .where(sql<string>`lower(name)`, '=', name.toLowerCase())
      .executeTakeFirst();
    return row !== undefined;
  }

  async knownNames(serverId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('mc_players')
      .select('name')
      .where('server_id', '=', serverId)
      .execute();
    return rows.map((row) => row.name);
  }

  async prune(now: number): Promise<void> {
    await this.db
      .deleteFrom('mc_player_sessions')
      .where('left_at', '<', now - SESSION_RETENTION_MS)
      .execute();
  }
}
