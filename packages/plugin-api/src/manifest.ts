import { isValidPluginId } from '@outpost/shared';
import type { PluginContext } from './context.js';
import type { Migration } from './db.js';

/** Plugin API version implemented by this package. */
export const PLUGIN_API_VERSION = 1;

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const MIGRATION_NAME_PATTERN = /^\d{4}_[a-z0-9_]+$/;

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
  /** Migrations for the plugin's own tables, in order. They run before `setup`. */
  migrations?: readonly Migration[];
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
  return plugin;
}
