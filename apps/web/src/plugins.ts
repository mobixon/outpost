import about from '@outpost/plugin-about/web';
import { API_PREFIX, pluginListSchema } from '@outpost/shared';
import { apiFetch, type WebPluginDefinition } from '@outpost/web-plugin-api';

/** Web parts of all built-in plugins; the server decides which of them are enabled. */
export const builtInWebPlugins: readonly WebPluginDefinition[] = [about];

export async function loadEnabledPlugins(): Promise<{
  plugins: WebPluginDefinition[];
  apiAvailable: boolean;
}> {
  try {
    const { plugins } = await apiFetch(`${API_PREFIX}/plugins`, pluginListSchema);
    const enabled = new Set(plugins.map((plugin) => plugin.id));
    return {
      plugins: builtInWebPlugins.filter((plugin) => enabled.has(plugin.id)),
      apiAvailable: true,
    };
  } catch {
    return { plugins: [], apiAvailable: false };
  }
}
