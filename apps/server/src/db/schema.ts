import type { RoleKey } from '@outpost/shared';

/** Tables owned by the core. Plugins describe their own tables in their packages. */
export interface CoreTables {
  roles: RolesTable;
  servers: ServersTable;
  server_members: ServerMembersTable;
  outpost_migrations: MigrationsTable;
  plugin_kv: PluginKvTable;
  users: UsersTable;
  user_backup_codes: UserBackupCodesTable;
  sessions: SessionsTable;
  user_identities: UserIdentitiesTable;
  invitations: InvitationsTable;
  audit_log: AuditLogTable;
}

export interface MigrationsTable {
  /** `outpost.core` or a plugin id. */
  scope: string;
  name: string;
  applied_at: number;
}

export interface PluginKvTable {
  plugin_id: string;
  /** Empty for instance-wide values. */
  scope: string;
  key: string;
  /** JSON */
  value: string;
  updated_at: number;
}

export interface UsersTable {
  id: string;
  /** Lowercase login name. */
  username: string;
  /** argon2id hash; null for accounts that can only sign in through an external provider. */
  password_hash: string | null;
  is_superadmin: number;
  /** TOTP secret, sealed with the secret key, once two-factor authentication is enabled. */
  totp_secret: string | null;
  /** Sealed secret during enrollment, before the first code has been confirmed. */
  totp_pending_secret: string | null;
  /** Last accepted TOTP time step; older and equal steps are rejected as replays. */
  totp_last_step: number | null;
  totp_enabled_at: number | null;
  disabled_at: number | null;
  /** `light`, `dark` or `system`; null until the user chooses a theme. */
  theme: string | null;
  created_at: number;
  updated_at: number;
}

export interface UserBackupCodesTable {
  user_id: string;
  code_hash: string;
  used_at: number | null;
}

export interface SessionsTable {
  /** Public id, used to list and revoke sessions. */
  id: string;
  /** SHA-256 of the cookie token; the token itself is never stored. */
  token_hash: string;
  user_id: string;
  /** `mfa`: password accepted, second factor pending. */
  status: 'mfa' | 'active';
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  /** Until when sensitive actions are allowed without confirming the password again. */
  sudo_until: number | null;
  ip: string | null;
  user_agent: string | null;
  /** 1 when a trusted provider confirmed a multi-factor login, which counts as Outpost's own 2FA. */
  external_mfa: number;
}

/** Accounts at external login providers (GitHub, OIDC) linked to Outpost users. */
export interface UserIdentitiesTable {
  /** `github` or the id of an OIDC provider. */
  provider: string;
  /** The user's stable id at the provider: the GitHub user id or the OIDC `sub` claim. */
  subject: string;
  user_id: string;
  /** Username or email address at the provider, for display only. */
  display_name: string | null;
  created_at: number;
  last_used_at: number | null;
}

export interface InvitationsTable {
  id: string;
  /** SHA-256 of the token in the invitation link; the token itself is never stored. */
  token_hash: string;
  /** The new account becomes a superadmin. */
  is_superadmin: number;
  note: string | null;
  created_by: string | null;
  created_at: number;
  expires_at: number;
  used_by: string | null;
  used_at: number | null;
  /** The new account becomes a member of this server with `role_key`. */
  server_id: string | null;
  role_key: RoleKey | null;
}

/** Server roles. Built-in roles get their permissions from the permission registry. */
export interface RolesTable {
  key: string;
  rank: number;
  builtin: number;
  /** JSON list of permission keys, for custom roles (a later version). */
  permissions: string | null;
  created_at: number;
}

export interface ServersTable {
  id: string;
  /** Short name used in URLs of the web UI. */
  slug: string;
  name: string;
  /** Game module id, e.g. `minecraft-java`; null until the server is connected. */
  game: string | null;
  /** JSON: how Outpost reaches the server, with the RCON password sealed. */
  connection: string | null;
  created_at: number;
  updated_at: number;
}

export interface ServerMembersTable {
  server_id: string;
  user_id: string;
  role_key: RoleKey;
  created_at: number;
}

export interface AuditLogTable {
  id: string;
  at: number;
  /** Kept when the user is deleted, so no foreign key. */
  user_id: string | null;
  /** Kept when the server is deleted, so no foreign key. */
  server_id: string | null;
  action: string;
  target: string | null;
  /** JSON */
  details: string | null;
  ip: string | null;
}
