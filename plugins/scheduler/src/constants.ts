// Kept apart from the schemas, so that the web entry of the plugin stays small.

export const SCHEDULER_PLUGIN_ID = 'outpost.scheduler';

export const SchedulerPermission = {
  view: 'scheduler.view',
  manage: 'scheduler.manage',
} as const;

export const TASK_TYPES = ['command', 'announcement'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

/**
 * The permission of the console module that a task type also needs, so that a task cannot do more
 * than its author could do by hand.
 */
export const TASK_TYPE_PERMISSION: Readonly<Record<TaskType, string>> = {
  command: 'console.execute',
  announcement: 'chat.send',
};
