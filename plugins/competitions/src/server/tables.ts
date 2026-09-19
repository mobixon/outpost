import type { Migration } from '@outpost/plugin-api';
import type { EventState } from '../shared.js';

export interface CompetitionsTables {
  comp_events: {
    id: string;
    server_id: string;
    name: string;
    timezone: string;
    state: EventState;
    /** Unix epoch milliseconds. */
    starts_at: number;
    ends_at: number;
    /** JSON: the metric, scoring, participants, rewards and messages. */
    config: string;
    /** When the counters at the start were taken. */
    baseline_at: number | null;
    /** When the standings in `comp_scores` were counted. */
    counted_at: number | null;
    /** JSON: the standings at the end, frozen. */
    results: string | null;
    finished_at: number | null;
    problem: string | null;
    created_by: string | null;
    created_at: number;
    updated_at: number;
  };
  /** The counters of the players when the competition started; a player who is not here had 0. */
  comp_baselines: {
    event_id: string;
    uuid: string;
    value: number;
  };
  /** The last count of the players who take part and have scored. */
  comp_scores: {
    event_id: string;
    uuid: string;
    name: string;
    score: number;
    /** When the score last changed: of two players with one score, the earlier one is ahead. */
    changed_at: number;
  };
}

export const migrations: readonly Migration[] = [
  {
    name: '0001_competitions',
    async up(db, { types }) {
      await db.schema
        .createTable('comp_events')
        .addColumn('id', 'text', (column) => column.primaryKey())
        .addColumn('server_id', 'text', (column) =>
          column.notNull().references('servers.id').onDelete('cascade'),
        )
        .addColumn('name', 'text', (column) => column.notNull())
        .addColumn('timezone', 'text', (column) => column.notNull())
        .addColumn('state', 'text', (column) => column.notNull())
        .addColumn('starts_at', types.timestamp, (column) => column.notNull())
        .addColumn('ends_at', types.timestamp, (column) => column.notNull())
        .addColumn('config', types.json, (column) => column.notNull())
        .addColumn('baseline_at', types.timestamp)
        .addColumn('counted_at', types.timestamp)
        .addColumn('results', types.json)
        .addColumn('finished_at', types.timestamp)
        .addColumn('problem', 'text')
        .addColumn('created_by', 'text')
        .addColumn('created_at', types.timestamp, (column) => column.notNull())
        .addColumn('updated_at', types.timestamp, (column) => column.notNull())
        .execute();
      await db.schema
        .createIndex('comp_events_server_idx')
        .on('comp_events')
        .columns(['server_id', 'starts_at'])
        .execute();
      await db.schema
        .createIndex('comp_events_state_idx')
        .on('comp_events')
        .column('state')
        .execute();

      await db.schema
        .createTable('comp_baselines')
        .addColumn('event_id', 'text', (column) =>
          column.notNull().references('comp_events.id').onDelete('cascade'),
        )
        .addColumn('uuid', 'text', (column) => column.notNull())
        .addColumn('value', 'integer', (column) => column.notNull())
        .addPrimaryKeyConstraint('comp_baselines_pk', ['event_id', 'uuid'])
        .execute();

      await db.schema
        .createTable('comp_scores')
        .addColumn('event_id', 'text', (column) =>
          column.notNull().references('comp_events.id').onDelete('cascade'),
        )
        .addColumn('uuid', 'text', (column) => column.notNull())
        .addColumn('name', 'text', (column) => column.notNull())
        .addColumn('score', 'integer', (column) => column.notNull())
        .addColumn('changed_at', types.timestamp, (column) => column.notNull())
        .addPrimaryKeyConstraint('comp_scores_pk', ['event_id', 'uuid'])
        .execute();
    },
  },
];
