import type { z } from 'zod';

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

type Parsed<S extends RouteSchema, K extends keyof RouteSchema> = S[K] extends z.ZodType
  ? z.output<S[K]>
  : undefined;

export interface RouteRequest<S extends RouteSchema, A extends RouteAccess = 'user'> {
  params: Parsed<S, 'params'>;
  query: Parsed<S, 'querystring'>;
  body: Parsed<S, 'body'>;
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
  route<S extends RouteSchema, A extends RouteAccess = 'user'>(route: RouteDefinition<S, A>): void;
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
