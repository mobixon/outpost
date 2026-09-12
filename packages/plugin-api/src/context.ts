import type { PluginInfo } from '@outpost/shared';
import type { Kysely } from 'kysely';
import type { EventBus } from './events.js';
import type { HttpRegistry } from './http.js';

export interface PluginLogger {
  debug(message: string, details?: Record<string, unknown>): void;
  info(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
}

/** Small instance-wide storage private to one plugin. Values are stored as JSON. */
export interface KeyValueStore {
  /** Returns the stored value, or `undefined` when the key is not set. Validate it before use. */
  get(key: string): Promise<unknown>;
  /** Stores any JSON-serializable value except `undefined`. */
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface PluginAuditEntry {
  /** Short action name, stored as `<plugin id>.<action>`, e.g. `outpost.players.ban`. */
  action: string;
  userId?: string;
  target?: string;
  details?: Record<string, unknown>;
  ip?: string;
}

export interface PluginContext {
  readonly plugin: PluginInfo;
  readonly instance: { readonly version: string };
  readonly logger: PluginLogger;
  readonly events: EventBus;
  /** The instance audit log. Record every change a user makes through the plugin. */
  readonly audit: { record(entry: PluginAuditEntry): Promise<void> };
  /** Registers HTTP routes under `/api/v1/plugins/<plugin id>`. Only usable during `setup`. */
  readonly http: HttpRegistry;
  readonly kv: KeyValueStore;
  /**
   * Database access for the plugin's own tables, created by its migrations. Pass the table types
   * as the generic parameter and prefix table names with something plugin-specific.
   */
  db<Tables>(): Kysely<Tables>;
  /** Enabled plugins in setup order. */
  plugins(): readonly PluginInfo[];
  /** Registers a cleanup callback; callbacks run in reverse registration order on shutdown. */
  onShutdown(callback: () => void | Promise<void>): void;
}
