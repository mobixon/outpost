/**
 * Public contracts for Outpost plugins.
 *
 * Built-in modules and (later) third-party plugins depend only on this package,
 * so everything exported here is part of the plugin API surface.
 */

/** Plugin API version implemented by this package. */
export const PLUGIN_API_VERSION = 1;

// At least two dot-separated segments of lowercase words joined by single hyphens.
const PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export interface PluginManifest {
  /** Unique id, e.g. `outpost.players` or `acme.discord-bridge`. */
  id: string;
  /** The plugin's own semver version. */
  version: string;
  /** Plugin API version the plugin was written against. */
  apiVersion: number;
}

export class PluginDefinitionError extends Error {
  override name = 'PluginDefinitionError';
}

/** Validates a plugin definition and returns it unchanged. */
export function definePlugin<T extends PluginManifest>(plugin: T): T {
  if (!PLUGIN_ID_PATTERN.test(plugin.id)) {
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
  return plugin;
}
