import type { ColumnTypes, Migration, MigrationContext, SqlDialect } from '@outpost/plugin-api';
import type { Kysely } from 'kysely';
import type { CoreTables } from './schema.js';

const COLUMN_TYPES: ColumnTypes = { timestamp: 'bigint', json: 'text', boolean: 'integer' };

export interface MigrationLogger {
  info(details: object, message: string): void;
  warn(details: object, message: string): void;
}

/**
 * Applies the migrations of one scope (the core or a plugin) that have not been applied yet.
 * Each migration runs in its own transaction together with its bookkeeping row.
 */
export async function runMigrations(
  db: Kysely<CoreTables>,
  dialect: SqlDialect,
  scope: string,
  migrations: readonly Migration[],
  log: MigrationLogger,
): Promise<void> {
  await db.schema
    .createTable('outpost_migrations')
    .ifNotExists()
    .addColumn('scope', 'text', (column) => column.notNull())
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('applied_at', 'bigint', (column) => column.notNull())
    .addPrimaryKeyConstraint('outpost_migrations_pk', ['scope', 'name'])
    .execute();

  const rows = await db
    .selectFrom('outpost_migrations')
    .select('name')
    .where('scope', '=', scope)
    .execute();
  const applied = new Set(rows.map((row) => row.name));
  const known = new Set(migrations.map((migration) => migration.name));
  const unknown = [...applied].filter((name) => !known.has(name));
  if (unknown.length > 0) {
    log.warn({ migrations: unknown }, 'the database has migrations this version does not know');
  }

  const ctx: MigrationContext = { dialect, types: COLUMN_TYPES };
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    await db.transaction().execute(async (trx) => {
      await migration.up(trx, ctx);
      await trx
        .insertInto('outpost_migrations')
        .values({ scope, name: migration.name, applied_at: Date.now() })
        .execute();
    });
    log.info({ migration: migration.name }, 'applied migration');
  }
}
