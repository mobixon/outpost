// Kept apart from the schemas, so that the web entry of the plugin stays small.

export const COMPETITIONS_PLUGIN_ID = 'outpost.competitions';

export const CompetitionsPermission = {
  view: 'competitions.view',
  manage: 'competitions.manage',
  rewards: 'competitions.rewards',
} as const;

/** The permission of the console module that the commands of rewards also need. */
export const REWARD_COMMAND_PERMISSION = 'console.execute';
