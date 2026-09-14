import type { Migration } from '@outpost/plugin-api';

export interface PlayerDetailsTables {
  /** Icons and names downloaded from Mojang, one row per Minecraft version. */
  pd_assets: {
    version: string;
    /** The asset set as JSON (see `assetSetSchema`). */
    data: string;
    downloaded_at: number;
  };
}

export const migrations: readonly Migration[] = [
  {
    name: '0001_assets',
    async up(db, { types }) {
      await db.schema
        .createTable('pd_assets')
        .addColumn('version', 'text', (column) => column.primaryKey())
        .addColumn('data', types.json, (column) => column.notNull())
        .addColumn('downloaded_at', types.timestamp, (column) => column.notNull())
        .execute();
    },
  },
];
