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
  /** What the server supports with its connection and game module, e.g. `logs.stream`. */
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
 * see the server, 403 without the permission and 409 when the server lacks the capability.
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
