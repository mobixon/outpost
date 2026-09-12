import about from '@outpost/plugin-about/server';
import type { PluginDefinition } from '@outpost/plugin-api';

/** Plugins shipped with Outpost, in a stable registration order. */
export const builtInPlugins: readonly PluginDefinition[] = [about];
