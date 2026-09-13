import type { Migration } from '@outpost/plugin-api';
import type { TaskType } from '../constants.js';

export type RunTrigger = 'schedule' | 'manual';
export type RunStatus = 'ok' | 'failed' | 'skipped';

export interface SchedulerTables {
  sched_tasks: {
    id: string;
    server_id: string;
    name: string;
    type: TaskType;
    cron: string;
    timezone: string;
    /** JSON array: the commands, or the messages of an announcement. */
    lines: string;
    enabled: number;
    only_with_players: number;
    /** The announcement message the next run sends. */
    next_index: number;
    created_by: string | null;
    created_at: number;
    updated_at: number;
  };
  sched_runs: {
    id: string;
    task_id: string;
    trigger: RunTrigger;
    status: RunStatus;
    reason: string | null;
    output: string | null;
    /** The user of a manual run. */
    triggered_by: string | null;
    started_at: number;
    finished_at: number;
  };
}

export const migrations: readonly Migration[] = [
  {
    name: '0001_scheduler',
    async up(db, { types }) {
      await db.schema
        .createTable('sched_tasks')
        .addColumn('id', 'text', (column) => column.primaryKey())
        .addColumn('server_id', 'text', (column) =>
          column.notNull().references('servers.id').onDelete('cascade'),
        )
        .addColumn('name', 'text', (column) => column.notNull())
        .addColumn('type', 'text', (column) => column.notNull())
        .addColumn('cron', 'text', (column) => column.notNull())
        .addColumn('timezone', 'text', (column) => column.notNull())
        .addColumn('lines', types.json, (column) => column.notNull())
        .addColumn('enabled', types.boolean, (column) => column.notNull().defaultTo(1))
        .addColumn('only_with_players', types.boolean, (column) => column.notNull().defaultTo(0))
        .addColumn('next_index', 'integer', (column) => column.notNull().defaultTo(0))
        .addColumn('created_by', 'text')
        .addColumn('created_at', types.timestamp, (column) => column.notNull())
        .addColumn('updated_at', types.timestamp, (column) => column.notNull())
        .execute();
      await db.schema
        .createIndex('sched_tasks_server_idx')
        .on('sched_tasks')
        .column('server_id')
        .execute();

      await db.schema
        .createTable('sched_runs')
        .addColumn('id', 'text', (column) => column.primaryKey())
        .addColumn('task_id', 'text', (column) =>
          column.notNull().references('sched_tasks.id').onDelete('cascade'),
        )
        .addColumn('trigger', 'text', (column) => column.notNull())
        .addColumn('status', 'text', (column) => column.notNull())
        .addColumn('reason', 'text')
        .addColumn('output', 'text')
        .addColumn('triggered_by', 'text')
        .addColumn('started_at', types.timestamp, (column) => column.notNull())
        .addColumn('finished_at', types.timestamp, (column) => column.notNull())
        .execute();
      await db.schema
        .createIndex('sched_runs_task_started_idx')
        .on('sched_runs')
        .columns(['task_id', 'started_at'])
        .execute();
    },
  },
];
