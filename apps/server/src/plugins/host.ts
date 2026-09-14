import {
  parseDependency,
  type EventBus,
  type PluginContext,
  type PluginDefinition,
  type PluginLogger,
  type RouteAccess,
  type RouteDefinition,
  type RouteSchema,
  type ServerEventStreamDefinition,
  type ServerRouteDefinition,
  type ServerRouteSchema,
  type SqlDialect,
} from '@outpost/plugin-api';
import type { PluginInfo } from '@outpost/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Kysely } from 'kysely';
import type { AuditLog } from '../audit.js';
import { SecretBox } from '../auth/crypto.js';
import { CORE_SCOPE } from '../db/core-migrations.js';
import { runMigrations } from '../db/migrator.js';
import { scopedFiles } from '../files/scope.js';
import type { CoreTables } from '../db/schema.js';
import type { PermissionRegistry } from '../rbac/permissions.js';
import { createKeyValueStore } from './kv.js';

export class PluginLoadError extends Error {
  override name = 'PluginLoadError';
}

/**
 * Picks the enabled plugins according to `OUTPOST_PLUGINS` and orders them so that every plugin
 * comes after its dependencies. The selection is either a comma-separated list of ids to enable
 * or only exclusions (`-outpost.about`); empty means all available plugins.
 */
export function resolvePlugins(
  available: readonly PluginDefinition[],
  selection?: string,
): PluginDefinition[] {
  const byId = new Map<string, PluginDefinition>();
  for (const plugin of available) {
    if (plugin.id === CORE_SCOPE) {
      throw new PluginLoadError(`Plugin id "${CORE_SCOPE}" is reserved`);
    }
    if (byId.has(plugin.id)) throw new PluginLoadError(`Plugin "${plugin.id}" is registered twice`);
    byId.set(plugin.id, plugin);
  }
  const assertKnown = (id: string): void => {
    if (!byId.has(id)) throw new PluginLoadError(`OUTPOST_PLUGINS names unknown plugin "${id}"`);
  };

  const entries = (selection ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  const exclusions = entries.filter((entry) => entry.startsWith('-'));
  if (exclusions.length > 0 && exclusions.length < entries.length) {
    throw new PluginLoadError(
      'OUTPOST_PLUGINS must either list the plugins to enable or only exclude plugins ("-id"), not both',
    );
  }
  let enabled: Set<string>;
  if (entries.length === 0 || exclusions.length > 0) {
    enabled = new Set(byId.keys());
    for (const entry of exclusions) {
      const id = entry.slice(1);
      assertKnown(id);
      enabled.delete(id);
    }
  } else {
    entries.forEach(assertKnown);
    enabled = new Set(entries);
  }

  const ordered: PluginDefinition[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (plugin: PluginDefinition, path: readonly string[]): void => {
    const current = state.get(plugin.id);
    if (current === 'done') return;
    if (current === 'visiting') {
      throw new PluginLoadError(`Plugin dependency cycle: ${[...path, plugin.id].join(' -> ')}`);
    }
    state.set(plugin.id, 'visiting');
    for (const entry of plugin.dependsOn ?? []) {
      const dependency = parseDependency(entry);
      const target = byId.get(dependency.id);
      if (target === undefined || !enabled.has(dependency.id)) {
        if (dependency.optional) continue;
        const reason = target === undefined ? 'not installed' : 'disabled';
        throw new PluginLoadError(
          `Plugin "${plugin.id}" requires "${dependency.id}", which is ${reason}`,
        );
      }
      visit(target, [...path, plugin.id]);
    }
    state.set(plugin.id, 'done');
    ordered.push(plugin);
  };
  // Visiting in registration order keeps the result stable for independent plugins.
  for (const plugin of available) {
    if (enabled.has(plugin.id)) visit(plugin, []);
  }
  return ordered;
}

export interface PluginHostOptions {
  db: Kysely<CoreTables>;
  dialect: SqlDialect;
  events: EventBus;
  audit: AuditLog;
  logger: FastifyBaseLogger;
  instanceVersion: string;
  /** Receives the permissions the plugins declare. */
  permissions: PermissionRegistry;
  /** Key material for the plugins' secret boxes. */
  secretKey: string;
  servers: Omit<PluginContext['servers'], 'supports'>;
  commands: PluginContext['commands'];
  files: PluginContext['files'];
  logs: PluginContext['logs'];
  hasPermission: PluginContext['permissions']['has'];
  /** Mounts a plugin route on the HTTP server. */
  registerRoute(pluginId: string, route: RouteDefinition<RouteSchema, RouteAccess>): void;
  /** Mounts a plugin route of a game server; `games` are those the plugin supports (null: all). */
  registerServerRoute(
    pluginId: string,
    route: ServerRouteDefinition<ServerRouteSchema>,
    games: readonly string[] | null,
  ): void;
  /** Mounts an event stream of a game server, with the same checks as a server route. */
  registerServerEvents(
    pluginId: string,
    stream: ServerEventStreamDefinition,
    games: readonly string[] | null,
  ): void;
}

function infoOf({ id, version, games }: PluginDefinition): PluginInfo {
  return { id, version, games: games === undefined ? null : [...games] };
}

/** Runs plugin migrations and `setup` in dependency order, and plugin cleanups on shutdown. */
export class PluginHost {
  readonly #plugins: readonly PluginDefinition[];
  readonly #options: PluginHostOptions;
  #cleanups: { pluginId: string; callback: () => void | Promise<void> }[] = [];
  #started = false;

  constructor(plugins: readonly PluginDefinition[], options: PluginHostOptions) {
    this.#plugins = plugins;
    this.#options = options;
  }

  get started(): boolean {
    return this.#started;
  }

  list(): PluginInfo[] {
    return this.#plugins.map(infoOf);
  }

  async start(): Promise<void> {
    const { db, dialect, events, audit, logger, instanceVersion, permissions } = this.#options;
    // All permissions first, so that routes can require permissions of other plugins.
    for (const plugin of this.#plugins) {
      for (const permission of plugin.permissions ?? []) {
        permissions.register(`plugin "${plugin.id}"`, permission);
      }
    }
    for (const plugin of this.#plugins) {
      const log = logger.child({ plugin: plugin.id });
      await runMigrations(db, dialect, plugin.id, plugin.migrations ?? [], log);

      let inSetup = true;
      const assertSetup = (method: string, url: string): void => {
        if (!inSetup) {
          throw new Error(
            `Plugin "${plugin.id}" can register routes only during setup (${method} ${url})`,
          );
        }
      };
      const secrets = new SecretBox(this.#options.secretKey, `plugin:${plugin.id}`);
      const ctx: PluginContext = {
        plugin: infoOf(plugin),
        instance: { version: instanceVersion },
        logger: toPluginLogger(log),
        events,
        audit: {
          record: (entry) => audit.record({ ...entry, action: `${plugin.id}.${entry.action}` }),
        },
        http: {
          route: (route) => {
            assertSetup(route.method, route.url);
            this.#options.registerRoute(plugin.id, route);
          },
          serverRoute: (route) => {
            assertSetup(route.method, route.url);
            if (!permissions.has(route.permission)) {
              throw new Error(
                `Plugin "${plugin.id}" route ${route.method} ${route.url} requires the unknown permission "${route.permission}"`,
              );
            }
            this.#options.registerServerRoute(
              plugin.id,
              route as unknown as ServerRouteDefinition<ServerRouteSchema>,
              plugin.games ?? null,
            );
          },
          serverEvents: (stream) => {
            assertSetup('GET', stream.url);
            if (!permissions.has(stream.permission)) {
              throw new Error(
                `Plugin "${plugin.id}" stream ${stream.url} requires the unknown permission "${stream.permission}"`,
              );
            }
            this.#options.registerServerEvents(plugin.id, stream, plugin.games ?? null);
          },
        },
        kv: createKeyValueStore(db, plugin.id),
        servers: {
          ...this.#options.servers,
          supports: (server) => plugin.games === undefined || plugin.games.includes(server.game),
        },
        commands: this.#options.commands,
        files: scopedFiles(plugin.id, plugin.files, this.#options.files),
        logs: this.#options.logs,
        permissions: { has: this.#options.hasPermission },
        secrets: {
          seal: (plaintext) => secrets.seal(plaintext),
          open: (sealed) => secrets.open(sealed),
        },
        db: <Tables>() => db as unknown as Kysely<Tables>,
        plugins: () => this.list(),
        onShutdown: (callback) => {
          this.#cleanups.push({ pluginId: plugin.id, callback });
        },
      };
      try {
        await plugin.setup?.(ctx);
      } finally {
        inSetup = false;
      }
      log.info({ version: plugin.version }, 'plugin started');
    }
    this.#started = true;
  }

  async stop(): Promise<void> {
    const cleanups = this.#cleanups.reverse();
    this.#cleanups = [];
    this.#started = false;
    for (const { pluginId, callback } of cleanups) {
      try {
        await callback();
      } catch (err) {
        this.#options.logger.error({ err, plugin: pluginId }, 'plugin cleanup failed');
      }
    }
  }
}

function toPluginLogger(log: FastifyBaseLogger): PluginLogger {
  return {
    debug: (message, details) => log.debug(details ?? {}, message),
    info: (message, details) => log.info(details ?? {}, message),
    warn: (message, details) => log.warn(details ?? {}, message),
    error: (message, details) => log.error(details ?? {}, message),
  };
}
