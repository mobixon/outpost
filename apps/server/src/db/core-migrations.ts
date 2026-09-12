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
];
