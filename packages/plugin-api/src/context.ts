import type { PluginInfo } from '@outpost/shared';
import type { Kysely } from 'kysely';
import type { EventBus } from './events.js';
import type { FileEntry, FileStat } from './files.js';
import type { HttpRegistry } from './http.js';
import type { ServerInfo } from './servers.js';

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
  /** The game server the action concerns; shown in the server's audit log. */
  serverId?: string;
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
  /** The game servers of the instance. */
  readonly servers: {
    get(id: string): Promise<ServerInfo | undefined>;
    list(): Promise<ServerInfo[]>;
    /** Whether the plugin supports the game of the server (see `games` of the plugin). */
    supports(server: ServerInfo): boolean;
  };
  readonly commands: {
    /**
     * Runs a console command on the server over its connection and returns the reply (often
     * empty). Throws an HttpError: 409 without a connection, 400 for a command that is too long
     * and 502 when the server cannot be reached.
     */
    send(serverId: string, command: string): Promise<string>;
  };
  /**
   * The files of a game server through its Files connector. Paths are relative to the server's
   * folder and use `/`, e.g. `server.properties` or `world/stats`; they cannot leave the folder.
   * Needs the capability `files.read` (`files.write` for `write`), otherwise throws an HttpError
   * 409; also 404 for a missing file and 413 for a file over 32 MiB.
   */
  readonly files: {
    read(serverId: string, path: string): Promise<Uint8Array>;
    /** Replaces the file atomically or creates it; its directory must exist. */
    write(serverId: string, path: string, data: Uint8Array | string): Promise<void>;
    /** null when nothing exists at the path. */
    stat(serverId: string, path: string): Promise<FileStat | null>;
    /** The entries of a directory, sorted by name; `''` is the server's folder. */
    list(serverId: string, path: string): Promise<FileEntry[]>;
  };
  readonly permissions: {
    /** Whether the user has the permission on the server; superadmins have all. */
    has(userId: string, serverId: string, permission: string): Promise<boolean>;
  };
  /**
   * Authenticated encryption for secrets the plugin stores, such as passwords of other systems.
   * The key is derived from OUTPOST_SECRET_KEY and differs per plugin.
   */
  readonly secrets: {
    seal(plaintext: string): string;
    /** Throws when the value was not sealed by this plugin or has been modified. */
    open(sealed: string): string;
  };
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
