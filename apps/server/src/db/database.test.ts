import type { Migration } from '@outpost/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createKeyValueStore } from '../plugins/kv.js';
import { createDatabase, type Database } from './connection.js';
import { CORE_SCOPE, coreMigrations } from './core-migrations.js';
import { runMigrations } from './migrator.js';

// PostgreSQL runs only when a throwaway database is provided (CI does this): the tests drop tables.
const targets = [{ name: 'sqlite', url: 'sqlite::memory:' }];
const postgresUrl = process.env['OUTPOST_TEST_POSTGRES_URL'];
if (postgresUrl) targets.push({ name: 'postgres', url: postgresUrl });

const silent = { info: () => {}, warn: () => {} };

describe.each(targets)('database ($name)', ({ url }) => {
  let database: Database;

  beforeEach(async () => {
    database = createDatabase(url);
    // Every core table, children before parents (foreign keys).
    const tables = [
      'test_items',
      'player_tasks',
      'invitations',
      'server_members',
      'servers',
      'roles',
      'user_identities',
      'user_backup_codes',
      'sessions',
      'users',
      'audit_log',
      'plugin_kv',
      'outpost_migrations',
    ];
    for (const table of tables) {
      await database.db.schema.dropTable(table).ifExists().execute();
    }
  });

  afterEach(async () => {
    await database.db.destroy();
  });

  it('applies each migration once and records it', async () => {
    const { db, dialect } = database;
    await runMigrations(db, dialect, CORE_SCOPE, coreMigrations, silent);
    await runMigrations(db, dialect, CORE_SCOPE, coreMigrations, silent);

    const rows = await db.selectFrom('outpost_migrations').selectAll().execute();
    expect(rows.map((row) => `${row.scope}/${row.name}`).sort()).toEqual([
      'outpost.core/0001_plugin_kv',
      'outpost.core/0002_auth',
      'outpost.core/0003_external_auth',
      'outpost.core/0004_servers',
      'outpost.core/0005_server_connections',
      'outpost.core/0006_user_theme',
      'outpost.core/0007_server_files',
      'outpost.core/0008_server_game',
      'outpost.core/0009_player_tasks',
    ]);
    expect(typeof rows[0]?.applied_at).toBe('number');
  });

  it('rolls back a failed migration completely', async () => {
    const { db, dialect } = database;
    const broken: Migration = {
      name: '0001_broken',
      async up(trx) {
        await trx.schema.createTable('test_items').addColumn('id', 'text').execute();
        throw new Error('boom');
      },
    };

    await expect(runMigrations(db, dialect, 'test.plugin', [broken], silent)).rejects.toThrow(
      'boom',
    );
    const tables = await db.introspection.getTables();
    expect(tables.map((table) => table.name)).not.toContain('test_items');
    const recorded = await db
      .selectFrom('outpost_migrations')
      .selectAll()
      .where('scope', '=', 'test.plugin')
      .execute();
    expect(recorded).toEqual([]);
  });

  it('stores JSON key-values separately per plugin', async () => {
    const { db, dialect } = database;
    await runMigrations(db, dialect, CORE_SCOPE, coreMigrations, silent);
    const first = createKeyValueStore(db, 'test.first');
    const second = createKeyValueStore(db, 'test.second');

    await first.set('config', { enabled: true, list: [1, 2] });
    await first.set('config', { enabled: false });
    await second.set('config', 'other');

    expect(await first.get('config')).toEqual({ enabled: false });
    expect(await second.get('config')).toBe('other');
    expect(await first.get('missing')).toBeUndefined();

    await first.delete('config');
    expect(await first.get('config')).toBeUndefined();
    expect(await second.get('config')).toBe('other');

    await expect(first.set('nothing', undefined)).rejects.toThrow(TypeError);
  });
});
