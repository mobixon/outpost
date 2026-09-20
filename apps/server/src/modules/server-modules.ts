import { HttpError, type EventBus } from '@outpost/plugin-api';
import type { PluginInfo } from '@outpost/shared';
import type { Kysely } from 'kysely';
import type { CoreTables } from '../db/schema.js';

/**
 * Which modules are on for which servers. A module is on for a server unless its owner switched it
 * off, except the modules that are off by default (`defaultEnabled: false`), which an owner
 * switches on where they are wanted. A module that is off is not shown, does not answer and is not
 * asked to look at the game server, so that it does not ask the game server anything either. The
 * choices are kept in memory too, because background jobs of the modules ask all the time.
 */
export class ServerModules {
  readonly #chosen = new Map<string, Map<string, boolean>>();
  #defaults: Map<string, boolean> | undefined;

  constructor(
    private readonly db: Kysely<CoreTables>,
    private readonly plugins: () => readonly PluginInfo[],
    private readonly events: EventBus,
  ) {}

  async load(): Promise<void> {
    this.#chosen.clear();
    const rows = await this.db.selectFrom('server_modules').selectAll().execute();
    for (const row of rows) {
      const chosen = this.#chosen.get(row.server_id) ?? new Map<string, boolean>();
      chosen.set(row.plugin_id, Number(row.enabled) === 1);
      this.#chosen.set(row.server_id, chosen);
    }
  }

  /** Whether a module is on for a server that has not been told otherwise. */
  #defaultOf(pluginId: string): boolean {
    if (this.#defaults === undefined) {
      const list = this.plugins();
      // The plugins are not known yet: everything is on until they are.
      if (list.length === 0) return true;
      this.#defaults = new Map(list.map((plugin) => [plugin.id, plugin.defaultEnabled]));
    }
    return this.#defaults.get(pluginId) ?? true;
  }

  isEnabled(serverId: string, pluginId: string): boolean {
    return this.#chosen.get(serverId)?.get(pluginId) ?? this.#defaultOf(pluginId);
  }

  /** The ids of the modules of a server that are off. */
  disabledFor(serverId: string, game: string): string[] {
    return this.modulesOf(game)
      .filter((plugin) => !this.isEnabled(serverId, plugin.id))
      .map((plugin) => plugin.id)
      .sort();
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
    const before = this.isEnabled(server.id, pluginId);
    const now = Date.now();
    // The choice is kept even when it is what the module would be anyway: it stays if the default
    // of the module changes.
    await this.db
      .insertInto('server_modules')
      .values({
        server_id: server.id,
        plugin_id: pluginId,
        enabled: enabled ? 1 : 0,
        changed_by: userId,
        changed_at: now,
      })
      .onConflict((conflict) =>
        conflict.columns(['server_id', 'plugin_id']).doUpdateSet({
          enabled: enabled ? 1 : 0,
          changed_by: userId,
          changed_at: now,
        }),
      )
      .execute();
    const chosen = this.#chosen.get(server.id) ?? new Map<string, boolean>();
    chosen.set(pluginId, enabled);
    this.#chosen.set(server.id, chosen);
    if (before !== enabled) {
      await this.events.emit('outpost.module.changed', {
        serverId: server.id,
        pluginId,
        enabled,
      });
    }
    return plugin;
  }
}
