import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from './connection.js';
import { CORE_SCOPE, coreMigrations } from './core-migrations.js';
import { runMigrations } from './migrator.js';

const silent = { info: () => {}, warn: () => {}, error: () => {} };

let database: Database;

afterEach(async () => {
  await database.db.destroy();
});

describe('the migration of the modules of servers', () => {
  it('keeps what was switched off and leaves the Events module on where it was on', async () => {
    database = createDatabase('sqlite::memory:');
    const { db } = database;
    await runMigrations(
      db,
      database.dialect,
      CORE_SCOPE,
      coreMigrations.filter((migration) => migration.name <= '0010_server_modules'),
      silent,
    );
    const now = Date.now();
    for (const id of ['a', 'b', 'c']) {
      await db
        .insertInto('servers')
        .values({
          id,
          slug: id,
          name: id,
          game: 'minecraft-java',
          connection: null,
          files: null,
          created_at: now,
          updated_at: now,
        })
        .execute();
    }
    // Before: only what was switched off was kept.
    await sql`insert into server_disabled_modules (server_id, plugin_id, disabled_by, disabled_at)
      values ('a', 'outpost.players', null, ${now}), ('b', 'outpost.competitions', null, ${now})`.execute(
      db,
    );

    await runMigrations(db, database.dialect, CORE_SCOPE, coreMigrations, silent);

    const rows = await db
      .selectFrom('server_modules')
      .select(['server_id', 'plugin_id', 'enabled'])
      .orderBy('server_id')
      .orderBy('plugin_id')
      .execute();
    expect(rows.map((row) => [row.server_id, row.plugin_id, Number(row.enabled)])).toEqual([
      // Server a: what was off stays off, and the Events module, which was on, stays on.
      ['a', 'outpost.competitions', 1],
      ['a', 'outpost.players', 0],
      // Server b switched Events off: that choice stays.
      ['b', 'outpost.competitions', 0],
      // Server c had nothing switched off: Events stays on.
      ['c', 'outpost.competitions', 1],
    ]);
    // The old table is gone.
    await expect(sql`select 1 from server_disabled_modules`.execute(db)).rejects.toThrow();
  });

  it('adds nothing on a new install: a new server gets the defaults of the modules', async () => {
    database = createDatabase('sqlite::memory:');
    await runMigrations(database.db, database.dialect, CORE_SCOPE, coreMigrations, silent);
    expect(await database.db.selectFrom('server_modules').selectAll().execute()).toEqual([]);
  });
});
