import type { Migration } from '@outpost/plugin-api';

/** Migration scope of the core tables; reserved, so no plugin can use this id. */
export const CORE_SCOPE = 'outpost.core';

export const coreMigrations: readonly Migration[] = [
  {
    name: '0001_plugin_kv',
    async up(db, { types }) {
      await db.schema
        .createTable('plugin_kv')
        .addColumn('plugin_id', 'text', (column) => column.notNull())
        .addColumn('scope', 'text', (column) => column.notNull())
        .addColumn('key', 'text', (column) => column.notNull())
        .addColumn('value', types.json, (column) => column.notNull())
        .addColumn('updated_at', types.timestamp, (column) => column.notNull())
        .addPrimaryKeyConstraint('plugin_kv_pk', ['plugin_id', 'scope', 'key'])
        .execute();
    },
  },
];
