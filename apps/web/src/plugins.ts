import about from '@outpost/plugin-about/web';
import consolePlugin from '@outpost/plugin-console/web';
import playersPlugin from '@outpost/plugin-players/web';
import schedulerPlugin from '@outpost/plugin-scheduler/web';
import { API_PREFIX, pluginListSchema } from '@outpost/shared';
import { apiFetch, type WebPluginDefinition } from '@outpost/web-plugin-api';

/** Web parts of all built-in plugins; the server decides which of them are enabled. */
export const builtInWebPlugins: readonly WebPluginDefinition[] = [
  about,
  consolePlugin,
  playersPlugin,
  schedulerPlugin,
];

/** Web parts of the plugins the server reports as enabled (needs a signed-in user). */
export async function loadEnabledPlugins(): Promise<WebPluginDefinition[]> {
  try {
    const { plugins } = await apiFetch(`${API_PREFIX}/plugins`, pluginListSchema);
    const enabled = new Set(plugins.map((plugin) => plugin.id));
    return builtInWebPlugins.filter((plugin) => enabled.has(plugin.id));
  } catch {
    return [];
  }
}
