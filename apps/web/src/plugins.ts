import about from '@outpost/plugin-about/web';
import consolePlugin from '@outpost/plugin-console/web';
import playerDetailsPlugin from '@outpost/plugin-player-details/web';
import playersPlugin from '@outpost/plugin-players/web';
import schedulerPlugin from '@outpost/plugin-scheduler/web';
import { API_PREFIX, pluginListSchema } from '@outpost/shared';
import { apiFetch, type WebPluginDefinition } from '@outpost/web-plugin-api';

/** Web parts of all built-in plugins; the server decides which of them are enabled. */
export const builtInWebPlugins: readonly WebPluginDefinition[] = [
  about,
  consolePlugin,
  playersPlugin,
  playerDetailsPlugin,
  schedulerPlugin,
];

export interface EnabledPlugins {
  plugins: WebPluginDefinition[];
  /** The games each plugin supports, as the server reports them; null for any game. */
  games: ReadonlyMap<string, readonly string[] | null>;
}

/** Web parts of the plugins the server reports as enabled (needs a signed-in user). */
export async function loadEnabledPlugins(): Promise<EnabledPlugins> {
  try {
    const { plugins } = await apiFetch(`${API_PREFIX}/plugins`, pluginListSchema);
    const games = new Map(plugins.map((plugin) => [plugin.id, plugin.games]));
    return { plugins: builtInWebPlugins.filter((plugin) => games.has(plugin.id)), games };
  } catch {
    return { plugins: [], games: new Map() };
  }
}
