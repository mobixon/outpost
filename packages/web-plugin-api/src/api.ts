import { apiErrorSchema } from '@outpost/shared';
import type { z } from 'zod';

/** An error response from the Outpost API. */
export class ApiError extends Error {
  override name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Requests JSON from the Outpost API and validates the response against `schema`. */
export async function apiFetch<S extends z.ZodType>(
  path: string,
  schema: S,
  init?: RequestInit,
): Promise<z.output<S>> {
  const headers = new Headers(init?.headers);
  headers.set('accept', 'application/json');
  const response = await fetch(path, { ...init, headers });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    throw parsed.success
      ? new ApiError(response.status, parsed.data.error.code, parsed.data.error.message)
      : new ApiError(response.status, 'http_error', `HTTP ${response.status}`);
  }
  return schema.parse(body);
}
