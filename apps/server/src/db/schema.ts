/** Tables owned by the core. Plugins describe their own tables in their packages. */
export interface CoreTables {
  outpost_migrations: MigrationsTable;
  plugin_kv: PluginKvTable;
  users: UsersTable;
  user_backup_codes: UserBackupCodesTable;
  sessions: SessionsTable;
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
}

export interface AuditLogTable {
  id: string;
  at: number;
  /** Kept when the user is deleted, so no foreign key. */
  user_id: string | null;
  action: string;
  target: string | null;
  /** JSON */
  details: string | null;
  ip: string | null;
}
