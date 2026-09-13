import type { RoleKey } from '@outpost/shared';
import type { z } from 'zod';
import type {
  AuthenticatedUser,
  HttpMethod,
  RouteResponse,
  RouteSchema,
  SchemaOutput,
} from './http.js';

/** Dotted lowercase words, e.g. `players.kick` or `console.read`. */
export const PERMISSION_KEY_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;

/** A permission a plugin adds for server members. */
export interface PermissionDeclaration {
  /** Unique across Outpost, e.g. `players.kick`. */
  key: string;
  /** Built-in roles that have the permission. Superadmins have every permission. */
  roles: readonly RoleKey[];
}

/** A game server as plugins see it. */
export interface ServerInfo {
  id: string;
  slug: string;
  name: string;
  /** The game of the server, e.g. `minecraft-java`; chosen when the server was added. */
  game: string;
  /** What the server supports with its connection and game module, e.g. `commands.send`. */
  capabilities: readonly string[];
}

/** Server routes may declare path parameters as an object; `serverId` is added by Outpost. */
export interface ServerRouteSchema extends RouteSchema {
  params?: z.ZodObject;
}

export interface ServerRouteRequest<S extends ServerRouteSchema> {
  params: SchemaOutput<S, 'params'>;
  query: SchemaOutput<S, 'querystring'>;
  body: SchemaOutput<S, 'body'>;
  user: AuthenticatedUser;
  server: ServerInfo;
  /** Everything the user may do on this server, for finer checks inside the handler. */
  permissions: ReadonlySet<string>;
  ip: string;
}

/**
 * A route of one game server, mounted at
 * `/api/v1/servers/:serverId/plugins/<plugin id><url>`. Outpost answers 404 when the user cannot
 * see the server, 403 without the permission, and 409 when the plugin does not support the game of
 * the server or the server lacks the capability.
 */
export interface ServerRouteDefinition<S extends ServerRouteSchema> {
  method: HttpMethod;
  /** Path below the plugin's base URL of the server, starting with `/`. */
  url: string;
  /** Permission the user needs on the server (declared by the core or a plugin). */
  permission: string;
  /** Capability the server must have, e.g. `commands.send`. */
  capability?: string;
  /** Require a recent password confirmation, for dangerous actions. */
  sudo?: boolean;
  schema?: S;
  handler(request: ServerRouteRequest<S>): RouteResponse<S> | Promise<RouteResponse<S>>;
}

/** One server-sent event; `data` is sent as JSON. */
export interface ServerEvent {
  event?: string;
  /** The browser sends it back as `Last-Event-ID` when it reconnects. */
  id?: string;
  data: unknown;
}

export interface ServerEventStreamRequest {
  server: ServerInfo;
  user: AuthenticatedUser;
  permissions: ReadonlySet<string>;
  /** The id of the last event the browser received, when it reconnects. */
  lastEventId: string | undefined;
  send(event: ServerEvent): void;
}

/**
 * A stream of server-sent events of one game server (`GET` at the URL of a server route, with the
 * same checks). Outpost keeps the connection alive and ends it after a while, so that the browser
 * reconnects (with `Last-Event-ID`) and its access is checked again.
 */
export interface ServerEventStreamDefinition {
  /** Path below the plugin's base URL of the server, starting with `/`. */
  url: string;
  permission: string;
  capability?: string;
  /** Starts sending; returns a function that stops when the connection ends. */
  open(request: ServerEventStreamRequest): (() => void) | Promise<() => void>;
}
