import type { z } from 'zod';
import type {
  ServerEventStreamDefinition,
  ServerRouteDefinition,
  ServerRouteSchema,
} from './servers.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Who may call a route: signed-in users with a complete login (default) or anyone. */
export type RouteAccess = 'user' | 'public';

export interface AuthenticatedUser {
  id: string;
  username: string;
  isSuperadmin: boolean;
}

export interface RouteSchema {
  params?: z.ZodType;
  querystring?: z.ZodType;
  body?: z.ZodType;
  /** Schema of the successful (200) response. */
  response?: z.ZodType;
}

/** The validated value of one part of a request. */
export type SchemaOutput<
  S extends RouteSchema,
  K extends keyof RouteSchema,
> = S[K] extends z.ZodType ? z.output<S[K]> : undefined;

export interface RouteRequest<S extends RouteSchema, A extends RouteAccess = 'user'> {
  params: SchemaOutput<S, 'params'>;
  query: SchemaOutput<S, 'querystring'>;
  body: SchemaOutput<S, 'body'>;
  /** The signed-in user. Public routes get `undefined` for anonymous callers. */
  user: A extends 'public' ? AuthenticatedUser | undefined : AuthenticatedUser;
  /** Client IP address (behind a reverse proxy only with OUTPOST_TRUST_PROXY). */
  ip: string;
}

export type RouteResponse<S extends RouteSchema> = S['response'] extends z.ZodType
  ? z.output<S['response']>
  : unknown;

export interface RouteDefinition<S extends RouteSchema, A extends RouteAccess = 'user'> {
  method: HttpMethod;
  /** Path below the plugin's base URL, starting with `/`, e.g. `/info` or `/items/:id`. */
  url: string;
  /** Defaults to `user`. State-changing requests also need the CSRF header in both cases. */
  access?: A;
  /** Requests are validated and responses serialized with these schemas. */
  schema?: S;
  handler(request: RouteRequest<S, A>): RouteResponse<S> | Promise<RouteResponse<S>>;
}

export interface HttpRegistry {
  /** A route under `/api/v1/plugins/<plugin id>`. */
  route<S extends RouteSchema, A extends RouteAccess = 'user'>(route: RouteDefinition<S, A>): void;
  /** A route of one game server, with permission and capability checks. */
  serverRoute<S extends ServerRouteSchema>(route: ServerRouteDefinition<S>): void;
  /** A stream of server-sent events of one game server, with the same checks. */
  serverEvents(stream: ServerEventStreamDefinition): void;
}

/** Throw from a route handler to answer with a specific status code and error code. */
export class HttpError extends Error {
  override name = 'HttpError';

  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
