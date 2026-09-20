import type { Migration } from '@outpost/plugin-api';
import { sql } from 'kysely';

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
  {
    name: '0002_auth',
    async up(db, { types }) {
      await db.schema
        .createTable('users')
        .addColumn('id', 'text', (column) => column.primaryKey())
        .addColumn('username', 'text', (column) => column.notNull().unique())
        .addColumn('password_hash', 'text')
        .addColumn('is_superadmin', types.boolean, (column) => column.notNull().defaultTo(0))
        .addColumn('totp_secret', 'text')
        .addColumn('totp_pending_secret', 'text')
        .addColumn('totp_last_step', 'bigint')
        .addColumn('totp_enabled_at', types.timestamp)
        .addColumn('disabled_at', types.timestamp)
        .addColumn('created_at', types.timestamp, (column) => column.notNull())
        .addColumn('updated_at', types.timestamp, (column) => column.notNull())
        .execute();

      await db.schema
        .createTable('user_backup_codes')
        .addColumn('user_id', 'text', (column) =>
          column.notNull().references('users.id').onDelete('cascade'),
        )
        .addColumn('code_hash', 'text', (column) => column.notNull())
        .addColumn('used_at', types.timestamp)
        .addPrimaryKeyConstraint('user_backup_codes_pk', ['user_id', 'code_hash'])
        .execute();

      await db.schema
        .createTable('sessions')
        .addColumn('id', 'text', (column) => column.primaryKey())
        .addColumn('token_hash', 'text', (column) => column.notNull().unique())
        .addColumn('user_id', 'text', (column) =>
          column.notNull().references('users.id').onDelete('cascade'),
        )
        .addColumn('status', 'text', (column) => column.notNull())
        .addColumn('created_at', types.timestamp, (column) => column.notNull())
        .addColumn('last_seen_at', types.timestamp, (column) => column.notNull())
        .addColumn('expires_at', types.timestamp, (column) => column.notNull())
        .addColumn('sudo_until', types.timestamp)
        .addColumn('ip', 'text')
        .addColumn('user_agent', 'text')
        .execute();
      await db.schema
        .createIndex('sessions_user_id_idx')
        .on('sessions')
        .column('user_id')
        .execute();

      await db.schema
        .createTable('audit_log')
        .addColumn('id', 'text', (column) => column.primaryKey())
        .addColumn('at', types.timestamp, (column) => column.notNull())
        .addColumn('user_id', 'text')
        .addColumn('action', 'text', (column) => column.notNull())
        .addColumn('target', 'text')
        .addColumn('details', types.json)
        .addColumn('ip', 'text')
        .execute();
      await db.schema.createIndex('audit_log_at_idx').on('audit_log').column('at').execute();
    },
  },
  {
    name: '0003_external_auth',
    async up(db, { types }) {
      await db.schema
        .createTable('user_identities')
        .addColumn('provider', 'text', (column) => column.notNull())
        .addColumn('subject', 'text', (column) => column.notNull())
        .addColumn('user_id', 'text', (column) =>
          column.notNull().references('users.id').onDelete('cascade'),
        )
        .addColumn('display_name', 'text')
        .addColumn('created_at', types.timestamp, (column) => column.notNull())
        .addColumn('last_used_at', types.timestamp)
        .addPrimaryKeyConstraint('user_identities_pk', ['provider', 'subject'])
        .addUniqueConstraint('user_identities_user_provider_unique', ['user_id', 'provider'])
        .execute();

      await db.schema
        .createTable('invitations')
        .addColumn('id', 'text', (column) => column.primaryKey())
        .addColumn('token_hash', 'text', (column) => column.notNull().unique())
        .addColumn('is_superadmin', types.boolean, (column) => column.notNull().defaultTo(0))
        .addColumn('note', 'text')
        .addColumn('created_by', 'text', (column) =>
          column.references('users.id').onDelete('set null'),
        )
        .addColumn('created_at', types.timestamp, (column) => column.notNull())
        .addColumn('expires_at', types.timestamp, (column) => column.notNull())
        .addColumn('used_by', 'text', (column) =>
          column.references('users.id').onDelete('set null'),
        )
        .addColumn('used_at', types.timestamp)
        .execute();

      await db.schema
        .alterTable('sessions')
        .addColumn('external_mfa', types.boolean, (column) => column.notNull().defaultTo(0))
        .execute();
    },
  },
  {
    name: '0004_servers',
    async up(db, { types }) {
      await db.schema
        .createTable('roles')
        .addColumn('key', 'text', (column) => column.primaryKey())
        .addColumn('rank', 'integer', (column) => column.notNull())
        .addColumn('builtin', types.boolean, (column) => column.notNull().defaultTo(0))
        .addColumn('permissions', types.json)
        .addColumn('created_at', types.timestamp, (column) => column.notNull())
        .execute();
      const now = Date.now();
      await db
        .insertInto('roles')
        .values(
          (
            [
              ['owner', 4],
              ['admin', 3],
              ['moderator', 2],
              ['viewer', 1],
            ] as const
          ).map(([key, rank]) => ({ key, rank, builtin: 1, permissions: null, created_at: now })),
        )
        .execute();

      await db.schema
        .createTable('servers')
        .addColumn('id', 'text', (column) => column.primaryKey())
        .addColumn('slug', 'text', (column) => column.notNull().unique())
        .addColumn('name', 'text', (column) => column.notNull())
        .addColumn('created_at', types.timestamp, (column) => column.notNull())
        .addColumn('updated_at', types.timestamp, (column) => column.notNull())
        .execute();

      await db.schema
        .createTable('server_members')
        .addColumn('server_id', 'text', (column) =>
          column.notNull().references('servers.id').onDelete('cascade'),
        )
        .addColumn('user_id', 'text', (column) =>
          column.notNull().references('users.id').onDelete('cascade'),
        )
        .addColumn('role_key', 'text', (column) => column.notNull().references('roles.key'))
        .addColumn('created_at', types.timestamp, (column) => column.notNull())
        .addPrimaryKeyConstraint('server_members_pk', ['server_id', 'user_id'])
        .execute();
      await db.schema
        .createIndex('server_members_user_id_idx')
        .on('server_members')
        .column('user_id')
        .execute();

      // One column per statement: SQLite adds only one at a time.
      await db.schema
        .alterTable('invitations')
        .addColumn('server_id', 'text', (column) =>
          column.references('servers.id').onDelete('cascade'),
        )
        .execute();
      await db.schema
        .alterTable('invitations')
        .addColumn('role_key', 'text', (column) => column.references('roles.key'))
        .execute();

      await db.schema.alterTable('audit_log').addColumn('server_id', 'text').execute();
      await db.schema
        .createIndex('audit_log_server_at_idx')
        .on('audit_log')
        .columns(['server_id', 'at'])
        .execute();
    },
  },
  {
    name: '0005_server_connections',
    async up(db, { types }) {
      await db.schema.alterTable('servers').addColumn('game', 'text').execute();
      await db.schema.alterTable('servers').addColumn('connection', types.json).execute();
    },
  },
  {
    name: '0006_user_theme',
    async up(db) {
      await db.schema.alterTable('users').addColumn('theme', 'text').execute();
    },
  },
  {
    name: '0007_server_files',
    async up(db, { types }) {
      await db.schema.alterTable('servers').addColumn('files', types.json).execute();
    },
  },
  {
    // Every server is of one game from now on; the servers added before were Minecraft servers.
    name: '0008_server_game',
    async up(db) {
      await sql`update servers set game = 'minecraft-java' where game is null`.execute(db);
    },
  },
  {
    // Things to do when a player is online, for plugins (`ctx.playerTasks`).
    name: '0009_player_tasks',
    async up(db, { types }) {
      await db.schema
        .createTable('player_tasks')
        .addColumn('id', 'text', (column) => column.primaryKey())
        .addColumn('plugin_id', 'text', (column) => column.notNull())
        .addColumn('server_id', 'text', (column) =>
          column.notNull().references('servers.id').onDelete('cascade'),
        )
        .addColumn('player_uuid', 'text', (column) => column.notNull())
        .addColumn('player_name', 'text', (column) => column.notNull())
        .addColumn('kind', 'text', (column) => column.notNull())
        .addColumn('payload', types.json, (column) => column.notNull())
        .addColumn('status', 'text', (column) => column.notNull())
        .addColumn('attempts', 'integer', (column) => column.notNull())
        .addColumn('error', 'text')
        .addColumn('retry_at', types.timestamp, (column) => column.notNull())
        .addColumn('created_at', types.timestamp, (column) => column.notNull())
        .addColumn('updated_at', types.timestamp, (column) => column.notNull())
        .execute();
      await db.schema
        .createIndex('player_tasks_status_idx')
        .on('player_tasks')
        .columns(['status', 'server_id'])
        .execute();
      await db.schema
        .createIndex('player_tasks_plugin_idx')
        .on('player_tasks')
        .columns(['plugin_id', 'server_id'])
        .execute();
    },
  },
  {
    // Modules switched off for a server; every module is on until an owner switches it off.
    name: '0010_server_modules',
    async up(db, { types }) {
      await db.schema
        .createTable('server_disabled_modules')
        .addColumn('server_id', 'text', (column) =>
          column.notNull().references('servers.id').onDelete('cascade'),
        )
        .addColumn('plugin_id', 'text', (column) => column.notNull())
        .addColumn('disabled_by', 'text')
        .addColumn('disabled_at', types.timestamp, (column) => column.notNull())
        .addPrimaryKeyConstraint('server_disabled_modules_pk', ['server_id', 'plugin_id'])
        .execute();
    },
  },
  {
    // A module can be off by default, so what an owner chose is kept both ways. What was switched
    // off is copied; the servers that exist keep the Events module, which was on for everyone before
    // it became opt-in.
    name: '0011_server_modules_state',
    async up(db, { types }) {
      await db.schema
        .createTable('server_modules')
        .addColumn('server_id', 'text', (column) =>
          column.notNull().references('servers.id').onDelete('cascade'),
        )
        .addColumn('plugin_id', 'text', (column) => column.notNull())
        .addColumn('enabled', types.boolean, (column) => column.notNull())
        .addColumn('changed_by', 'text')
        .addColumn('changed_at', types.timestamp, (column) => column.notNull())
        .addPrimaryKeyConstraint('server_modules_pk', ['server_id', 'plugin_id'])
        .execute();
      await sql`insert into server_modules (server_id, plugin_id, enabled, changed_by, changed_at)
        select server_id, plugin_id, 0, disabled_by, disabled_at from server_disabled_modules`.execute(
        db,
      );
      await db.schema.dropTable('server_disabled_modules').execute();
      await sql`insert into server_modules (server_id, plugin_id, enabled, changed_by, changed_at)
        select id, 'outpost.competitions', 1, null, ${Date.now()} from servers
        where not exists (
          select 1 from server_modules
          where server_modules.server_id = servers.id
            and server_modules.plugin_id = 'outpost.competitions'
        )`.execute(db);
    },
  },
];
