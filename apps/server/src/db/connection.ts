import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SqlDialect } from '@outpost/plugin-api';
import SQLite from 'better-sqlite3';
import { Kysely, PostgresDialect, SqliteDialect } from 'kysely';
import pg from 'pg';
import { parseDatabaseUrl } from './database-url.js';
import type { CoreTables } from './schema.js';

const PG_INT8_OID = 20;

export interface Database {
  db: Kysely<CoreTables>;
  dialect: SqlDialect;
}

export function createDatabase(url: string): Database {
  const target = parseDatabaseUrl(url);

  if (target.dialect === 'sqlite') {
    if (target.path !== ':memory:') mkdirSync(dirname(target.path), { recursive: true });
    const sqlite = new SQLite(target.path);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
    return {
      db: new Kysely<CoreTables>({ dialect: new SqliteDialect({ database: sqlite }) }),
      dialect: 'sqlite',
    };
  }

  const pool = new pg.Pool({
    connectionString: target.url,
    types: {
      // BIGINT columns hold epoch milliseconds, which fit into a JS number; pg returns strings.
      getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
        oid === PG_INT8_OID
          ? (value: string) => Number(value)
          : pg.types.getTypeParser(oid, format)) as typeof pg.types.getTypeParser,
    },
  });
  return {
    db: new Kysely<CoreTables>({ dialect: new PostgresDialect({ pool }) }),
    dialect: 'postgres',
  };
}
