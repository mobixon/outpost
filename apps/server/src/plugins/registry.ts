import about from '@outpost/plugin-about/server';
import competitionsPlugin from '@outpost/plugin-competitions/server';
import consolePlugin from '@outpost/plugin-console/server';
import playerDetailsPlugin from '@outpost/plugin-player-details/server';
import playersPlugin from '@outpost/plugin-players/server';
import schedulerPlugin from '@outpost/plugin-scheduler/server';
import type { PluginDefinition } from '@outpost/plugin-api';

/** Plugins shipped with Outpost, in a stable registration order. */
export const builtInPlugins: readonly PluginDefinition[] = [
  about,
  consolePlugin,
  playersPlugin,
  playerDetailsPlugin,
  schedulerPlugin,
  competitionsPlugin,
];
