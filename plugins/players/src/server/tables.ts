import type { Migration } from '@outpost/plugin-api';

export interface PlayersTables {
  /** Players seen online on a server. */
  mc_players: {
    server_id: string;
    uuid: string;
    name: string;
    first_seen: number;
    last_seen: number;
    /** Sum of the finished sessions. */
    playtime_ms: number;
  };
  /** Online periods, from the first to the last poll that saw the player. */
  mc_player_sessions: {
    id: string;
    server_id: string;
    uuid: string;
    joined_at: number;
    left_at: number | null;
  };
  /** Bans and operator rights for players not seen yet, applied when they are seen online. */
  mc_pending_actions: {
    id: string;
    server_id: string;
    name: string;
    action: 'ban' | 'op';
    reason: string | null;
    created_by: string | null;
    created_at: number;
  };
}

export const migrations: readonly Migration[] = [
  {
    name: '0001_players',
    async up(db, { types }) {
      await db.schema
        .createTable('mc_players')
        .addColumn('server_id', 'text', (column) =>
          column.notNull().references('servers.id').onDelete('cascade'),
        )
        .addColumn('uuid', 'text', (column) => column.notNull())
        .addColumn('name', 'text', (column) => column.notNull())
        .addColumn('first_seen', types.timestamp, (column) => column.notNull())
        .addColumn('last_seen', types.timestamp, (column) => column.notNull())
        .addColumn('playtime_ms', 'bigint', (column) => column.notNull().defaultTo(0))
        .addPrimaryKeyConstraint('mc_players_pk', ['server_id', 'uuid'])
        .execute();
      await db.schema
        .createIndex('mc_players_server_last_seen_idx')
        .on('mc_players')
        .columns(['server_id', 'last_seen'])
        .execute();

      await db.schema
        .createTable('mc_player_sessions')
        .addColumn('id', 'text', (column) => column.primaryKey())
        .addColumn('server_id', 'text', (column) =>
          column.notNull().references('servers.id').onDelete('cascade'),
        )
        .addColumn('uuid', 'text', (column) => column.notNull())
        .addColumn('joined_at', types.timestamp, (column) => column.notNull())
        .addColumn('left_at', types.timestamp)
        .execute();
      await db.schema
        .createIndex('mc_player_sessions_player_idx')
        .on('mc_player_sessions')
        .columns(['server_id', 'uuid', 'joined_at'])
        .execute();

      await db.schema
        .createTable('mc_pending_actions')
        .addColumn('id', 'text', (column) => column.primaryKey())
        .addColumn('server_id', 'text', (column) =>
          column.notNull().references('servers.id').onDelete('cascade'),
        )
        .addColumn('name', 'text', (column) => column.notNull())
        .addColumn('action', 'text', (column) => column.notNull())
        .addColumn('reason', 'text')
        .addColumn('created_by', 'text')
        .addColumn('created_at', types.timestamp, (column) => column.notNull())
        .execute();
    },
  },
];
