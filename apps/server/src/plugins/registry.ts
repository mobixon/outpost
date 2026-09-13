import about from '@outpost/plugin-about/server';
import consolePlugin from '@outpost/plugin-console/server';
import playersPlugin from '@outpost/plugin-players/server';
import schedulerPlugin from '@outpost/plugin-scheduler/server';
import type { PluginDefinition } from '@outpost/plugin-api';

/** Plugins shipped with Outpost, in a stable registration order. */
export const builtInPlugins: readonly PluginDefinition[] = [
  about,
  consolePlugin,
  playersPlugin,
  schedulerPlugin,
];
