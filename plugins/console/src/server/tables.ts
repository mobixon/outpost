import type { Migration } from '@outpost/plugin-api';

export interface ConsoleTables {
  /** The commands each user ran on each server, to pick them again. */
  console_history: {
    id: string;
    server_id: string;
    user_id: string;
    command: string;
    /** How often the user ran it. */
    uses: number;
    used_at: number;
  };
}

export const migrations: readonly Migration[] = [
  {
    name: '0001_history',
    async up(db, { types }) {
      await db.schema
        .createTable('console_history')
        .addColumn('id', 'text', (column) => column.primaryKey())
        .addColumn('server_id', 'text', (column) =>
          column.notNull().references('servers.id').onDelete('cascade'),
        )
        .addColumn('user_id', 'text', (column) =>
          column.notNull().references('users.id').onDelete('cascade'),
        )
        .addColumn('command', 'text', (column) => column.notNull())
        .addColumn('uses', 'integer', (column) => column.notNull().defaultTo(1))
        .addColumn('used_at', types.timestamp, (column) => column.notNull())
        .addUniqueConstraint('console_history_command_key', ['server_id', 'user_id', 'command'])
        .execute();
      await db.schema
        .createIndex('console_history_user_idx')
        .on('console_history')
        .columns(['server_id', 'user_id', 'used_at'])
        .execute();
    },
  },
];
