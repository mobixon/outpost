import { GAME_ID_PATTERN, isValidPluginId, ROLE_KEYS } from '@outpost/shared';
import type { PluginContext } from './context.js';
import type { Migration } from './db.js';
import type { FileScopes } from './files.js';
import { PERMISSION_KEY_PATTERN, type PermissionDeclaration } from './servers.js';

/** Plugin API version implemented by this package. */
export const PLUGIN_API_VERSION = 1;

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const MIGRATION_NAME_PATTERN = /^\d{4}_[a-z0-9_]+$/;
const FILE_SCOPE_SEGMENT = /^(?:\*\*|[A-Za-z0-9_.*-]+)$/;

/** A file scope is a relative path whose names may hold `*`, or are `**`. */
const isValidFileScope = (scope: string) =>
  scope
    .split('/')
    .every(
      (segment) =>
        FILE_SCOPE_SEGMENT.test(segment) &&
        segment !== '.' &&
        segment !== '..' &&
        (segment === '**' || !segment.includes('**')),
    );

export interface PluginManifest {
  /** Unique id, e.g. `outpost.players` or `acme.discord-bridge`. */
  id: string;
  /** The plugin's own semver version. */
  version: string;
  /** Plugin API version the plugin was written against. */
  apiVersion: number;
}

export interface PluginDefinition extends PluginManifest {
  /**
   * Plugins that must be set up before this one. A `?` suffix marks an optional dependency
   * (`'outpost.console?'`): it is set up first when enabled and ignored otherwise.
   */
  dependsOn?: readonly string[];
  /**
   * The games the plugin supports, e.g. `['minecraft-java']`; unset for a plugin that works with
   * any game. Outpost shows its server tabs and serves its server routes only for these games.
   * A plugin with `games` is a module of servers: owners can switch it off for a server, unless it
   * is `essential`. A plugin without `games` is not tied to servers and cannot be switched off.
   */
  games?: readonly string[];
  /**
   * The plugin cannot be switched off for a server: the console and the like, without which a
   * server cannot be managed. Every other module of servers can be.
   */
  essential?: boolean;
  /**
   * The files of a game server the plugin reads and writes through `ctx.files`, e.g.
   * `{ read: ['server.properties'], write: ['whitelist.json'] }`. Outpost refuses other paths.
   */
  files?: FileScopes;
  /** Migrations for the plugin's own tables, in order. They run before `setup`. */
  migrations?: readonly Migration[];
  /** Server permissions the plugin adds, with the built-in roles that have them. */
  permissions?: readonly PermissionDeclaration[];
  /** Called once on startup, after the plugin's dependencies. Register routes and handlers here. */
  setup?(ctx: PluginContext): void | Promise<void>;
}

export class PluginDefinitionError extends Error {
  override name = 'PluginDefinitionError';
}

/** Splits a `dependsOn` entry into the plugin id and whether the dependency is optional. */
export function parseDependency(entry: string): { id: string; optional: boolean } {
  return entry.endsWith('?')
    ? { id: entry.slice(0, -1), optional: true }
    : { id: entry, optional: false };
}

/** Validates a plugin definition and returns it unchanged. */
export function definePlugin<T extends PluginDefinition>(plugin: T): T {
  if (!isValidPluginId(plugin.id)) {
    throw new PluginDefinitionError(
      `Invalid plugin id "${plugin.id}": expected lowercase dot-separated segments, e.g. "outpost.players"`,
    );
  }
  if (!SEMVER_PATTERN.test(plugin.version)) {
    throw new PluginDefinitionError(
      `Plugin "${plugin.id}" has an invalid version "${plugin.version}": expected semver, e.g. "1.2.3"`,
    );
  }
  if (plugin.apiVersion !== PLUGIN_API_VERSION) {
    throw new PluginDefinitionError(
      `Plugin "${plugin.id}" targets plugin API v${plugin.apiVersion}, but this Outpost supports v${PLUGIN_API_VERSION}`,
    );
  }
  for (const entry of plugin.dependsOn ?? []) {
    const dependency = parseDependency(entry);
    if (!isValidPluginId(dependency.id)) {
      throw new PluginDefinitionError(`Plugin "${plugin.id}" has an invalid dependency "${entry}"`);
    }
    if (dependency.id === plugin.id) {
      throw new PluginDefinitionError(`Plugin "${plugin.id}" cannot depend on itself`);
    }
  }
  const games = plugin.games;
  if (
    games !== undefined &&
    (games.length === 0 ||
      new Set(games).size !== games.length ||
      games.some((game) => !GAME_ID_PATTERN.test(game)))
  ) {
    throw new PluginDefinitionError(
      `Plugin "${plugin.id}" has an invalid list of games: expected unique ids like "minecraft-java"`,
    );
  }
  for (const scope of [...(plugin.files?.read ?? []), ...(plugin.files?.write ?? [])]) {
    if (!isValidFileScope(scope)) {
      throw new PluginDefinitionError(
        `Plugin "${plugin.id}" has an invalid file scope "${scope}": expected a relative path like "whitelist.json" or "world/stats/*.json"`,
      );
    }
  }
  let previous = '';
  for (const migration of plugin.migrations ?? []) {
    if (!MIGRATION_NAME_PATTERN.test(migration.name)) {
      throw new PluginDefinitionError(
        `Plugin "${plugin.id}" has an invalid migration name "${migration.name}": expected e.g. "0001_create_tables"`,
      );
    }
    if (migration.name <= previous) {
      throw new PluginDefinitionError(
        `Plugin "${plugin.id}" migrations must have unique names in ascending order ("${migration.name}" comes after "${previous}")`,
      );
    }
    previous = migration.name;
  }
  const keys = new Set<string>();
  for (const permission of plugin.permissions ?? []) {
    if (!PERMISSION_KEY_PATTERN.test(permission.key) || keys.has(permission.key)) {
      throw new PluginDefinitionError(
        `Plugin "${plugin.id}" has an invalid or duplicate permission "${permission.key}": expected unique keys like "players.kick"`,
      );
    }
    keys.add(permission.key);
    const unknown = permission.roles.find((role) => !ROLE_KEYS.includes(role));
    if (unknown !== undefined) {
      throw new PluginDefinitionError(
        `Plugin "${plugin.id}" gives permission "${permission.key}" to unknown role "${unknown}"`,
      );
    }
  }
  return plugin;
}
