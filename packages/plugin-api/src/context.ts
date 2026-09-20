import type { PluginInfo } from '@outpost/shared';
import type { Kysely } from 'kysely';
import type { EventBus } from './events.js';
import type { FileEntry, FileStat } from './files.js';
import type { GameEvents } from './game-events.js';
import type { HttpRegistry } from './http.js';
import type { LogLine } from './logs.js';
import type { PlayerTasks } from './player-tasks.js';
import type { ServerInfo } from './servers.js';
import type { Services } from './services.js';
import type { PlayerStatistics } from './stats.js';

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
    /**
     * Whether the plugin supports the game of the server (see `games` of the plugin) and has not
     * been switched off for it. Background jobs check this for every server before they touch it:
     * a module that is off must not ask the server anything.
     */
    supports(server: ServerInfo): boolean;
    /** Whether the plugin has not been switched off for the server; false for an unknown server. */
    enabledFor(serverId: string): boolean;
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
  /**
   * The log of a game server, followed while somebody listens. Needs the capability `logs.stream`,
   * otherwise throws an HttpError 409.
   */
  readonly logs: {
    /** The last lines of the log (up to 1000), oldest first. */
    recent(serverId: string): Promise<LogLine[]>;
    /**
     * Calls `listener` with the new lines as the server writes them; resolves with a function that
     * stops. Lines written between `recent` and `subscribe` in one go are not lost.
     */
    subscribe(serverId: string, listener: (lines: LogLine[]) => void): Promise<() => void>;
  };
  /**
   * What players do on the game server, read from its log. Needs the capability `game.events`
   * (the Files connector of a game that writes a log).
   */
  readonly gameEvents: GameEvents;
  /**
   * Messages to players in the chat of the game. Needs the capability `chat.tell` (RCON); throws
   * an HttpError 409 without it and 400 for a name that cannot be a player's or a message that is
   * too long. `&` codes color and style the text (`&6` gold, `&c` red, `&l` bold, `&r` reset).
   */
  readonly chat: {
    /**
     * `message` is a line, or an array of lines that are shown together and cost the server as few
     * commands as fit (usually one); line breaks inside a line become spaces.
     */
    tell(serverId: string, player: string, message: string | readonly string[]): Promise<void>;
    /** Shows the message to everyone online. */
    broadcast(serverId: string, message: string | readonly string[]): Promise<void>;
  };
  /** The statistics of the players. Needs the capability `stats.read` (the Files connector). */
  readonly stats: PlayerStatistics;
  /**
   * Things to do when a player is online, which survive a restart of Outpost. Needs the
   * capability `players.whenOnline` (RCON) to notice who is online.
   */
  readonly playerTasks: PlayerTasks;
  /** Services the plugins offer each other. */
  readonly services: Services;
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
