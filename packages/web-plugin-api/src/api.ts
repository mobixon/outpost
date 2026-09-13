import { apiErrorSchema, CSRF_HEADER } from '@outpost/shared';
import type { z } from 'zod';

/** An error response from the Outpost API. */
export class ApiError extends Error {
  override name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Extra data of some errors, e.g. the failed test of a connector. */
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export type SendMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

let unauthenticatedHandler: (() => void) | undefined;

/** Called when the session has ended (the API answers `unauthenticated`). Set by the web app. */
export function onUnauthenticated(handler: () => void): void {
  unauthenticatedHandler = handler;
}

async function call(method: 'GET' | SendMethod, path: string, body?: unknown): Promise<unknown> {
  const headers = new Headers({ accept: 'application/json' });
  if (method !== 'GET') headers.set(CSRF_HEADER, '1');
  if (body !== undefined) headers.set('content-type', 'application/json');
  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const data: unknown =
    response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(data);
    const error = parsed.success
      ? new ApiError(
          response.status,
          parsed.data.error.code,
          parsed.data.error.message,
          parsed.data.error.details,
        )
      : new ApiError(response.status, 'http_error', `HTTP ${response.status}`);
    if (error.code === 'unauthenticated') unauthenticatedHandler?.();
    throw error;
  }
  return data;
}

/** Requests JSON from the Outpost API and validates the response against `schema`. */
export async function apiFetch<S extends z.ZodType>(path: string, schema: S): Promise<z.output<S>> {
  return schema.parse(await call('GET', path));
}

/** Sends a state-changing request (with the CSRF header); validates the response if a schema is given. */
export function apiSend(method: SendMethod, path: string, body?: unknown): Promise<void>;
export function apiSend<S extends z.ZodType>(
  method: SendMethod,
  path: string,
  body: unknown,
  schema: S,
): Promise<z.output<S>>;
export async function apiSend(
  method: SendMethod,
  path: string,
  body?: unknown,
  schema?: z.ZodType,
): Promise<unknown> {
  const data = await call(method, path, body);
  return schema === undefined ? undefined : schema.parse(data);
}
