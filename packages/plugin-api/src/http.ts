import type { z } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

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

export interface RouteRequest<S extends RouteSchema> {
  params: Parsed<S, 'params'>;
  query: Parsed<S, 'querystring'>;
  body: Parsed<S, 'body'>;
}

export type RouteResponse<S extends RouteSchema> = S['response'] extends z.ZodType
  ? z.output<S['response']>
  : unknown;

export interface RouteDefinition<S extends RouteSchema> {
  method: HttpMethod;
  /** Path below the plugin's base URL, starting with `/`, e.g. `/info` or `/items/:id`. */
  url: string;
  /** Requests are validated and responses serialized with these schemas. */
  schema?: S;
  handler(request: RouteRequest<S>): RouteResponse<S> | Promise<RouteResponse<S>>;
}

export interface HttpRegistry {
  route<S extends RouteSchema>(route: RouteDefinition<S>): void;
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
