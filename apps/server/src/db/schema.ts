/** Tables owned by the core. Plugins describe their own tables in their packages. */
export interface CoreTables {
  outpost_migrations: MigrationsTable;
  plugin_kv: PluginKvTable;
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
