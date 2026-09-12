import type { Kysely } from 'kysely';

export { sql } from 'kysely';
export type { Generated, Insertable, Kysely, Selectable, Transaction, Updateable } from 'kysely';

export type SqlDialect = 'sqlite' | 'postgres';

/**
 * Column types that behave the same on SQLite and PostgreSQL. Migrations should use these for
 * anything beyond plain `text` and `integer`, so one migration works on both databases.
 */
export interface ColumnTypes {
  /** Unix epoch milliseconds, read back as a JS number. */
  readonly timestamp: 'bigint';
  /** A JSON document stored as text. */
  readonly json: 'text';
  /** 0 or 1. */
  readonly boolean: 'integer';
}

export interface MigrationContext {
  readonly dialect: SqlDialect;
  readonly types: ColumnTypes;
}

export interface Migration {
  /** Unique, sortable name such as `0001_create_tables`. Never rename an applied migration. */
  name: string;
  /**
   * Runs inside a transaction. The database is untyped on purpose: a migration works against
   * the schema as it was at that point in history, not the current one.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  up(db: Kysely<any>, ctx: MigrationContext): Promise<void>;
}
