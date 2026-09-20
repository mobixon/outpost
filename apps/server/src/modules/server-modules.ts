import { HttpError, type EventBus } from '@outpost/plugin-api';
import type { PluginInfo } from '@outpost/shared';
import type { Kysely } from 'kysely';
import type { CoreTables } from '../db/schema.js';

/**
 * Which modules are switched off for which servers. Every module is on for every server until
 * an owner switches it off; a module that is off is not shown, does not answer and is not asked to
 * look at the server, so that it does not ask the game server anything either. The list is kept in
 * memory too, because background jobs of the modules ask it all the time.
 */
export class ServerModules {
  readonly #disabled = new Map<string, Set<string>>();

  constructor(
    private readonly db: Kysely<CoreTables>,
    private readonly plugins: () => readonly PluginInfo[],
    private readonly events: EventBus,
  ) {}

  async load(): Promise<void> {
    this.#disabled.clear();
    const rows = await this.db.selectFrom('server_disabled_modules').selectAll().execute();
    for (const { server_id: serverId, plugin_id: pluginId } of rows) {
      const set = this.#disabled.get(serverId) ?? new Set<string>();
      set.add(pluginId);
      this.#disabled.set(serverId, set);
    }
  }

  isEnabled(serverId: string, pluginId: string): boolean {
    return !(this.#disabled.get(serverId)?.has(pluginId) ?? false);
  }

  disabledFor(serverId: string): string[] {
    return [...(this.#disabled.get(serverId) ?? [])].sort();
  }

  /** The modules a server of `game` has: the plugins that support its game. */
  modulesOf(game: string): PluginInfo[] {
    return this.plugins().filter((plugin) => plugin.games?.includes(game) === true);
  }

  /** Switches a module on or off for a server; the essential ones cannot be switched off. */
  async set(
    server: { id: string; game: string },
    pluginId: string,
    enabled: boolean,
    userId: string,
  ): Promise<PluginInfo> {
    const plugin = this.modulesOf(server.game).find((candidate) => candidate.id === pluginId);
    if (plugin === undefined) throw new HttpError(404, 'not_found', 'No such module');
    if (plugin.essential && !enabled) {
      throw new HttpError(409, 'module_essential', 'This module cannot be switched off');
    }
    if (enabled === this.isEnabled(server.id, pluginId)) return plugin;
    if (enabled) {
      await this.db
        .deleteFrom('server_disabled_modules')
        .where('server_id', '=', server.id)
        .where('plugin_id', '=', pluginId)
        .execute();
      this.#disabled.get(server.id)?.delete(pluginId);
    } else {
      await this.db
        .insertInto('server_disabled_modules')
        .values({
          server_id: server.id,
          plugin_id: pluginId,
          disabled_by: userId,
          disabled_at: Date.now(),
        })
        .onConflict((conflict) => conflict.doNothing())
        .execute();
      const set = this.#disabled.get(server.id) ?? new Set<string>();
      set.add(pluginId);
      this.#disabled.set(server.id, set);
    }
    await this.events.emit('outpost.module.changed', {
      serverId: server.id,
      pluginId,
      enabled,
    });
    return plugin;
  }
}
