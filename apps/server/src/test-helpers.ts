// Helpers for tests that run the whole app with fastify.inject().
import type { PluginDefinition } from '@outpost/plugin-api';
import { CSRF_HEADER } from '@outpost/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from './app.js';
import type { GithubEndpoints } from './auth/providers.js';
import { SESSION_COOKIE } from './auth/service.js';
import { loadConfig } from './config.js';

export const TEST_SETUP_TOKEN = 'test-setup-token-0123456789';
export const TEST_PASSWORD = 'correct horse battery staple';

export function testConfig(env: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    OUTPOST_LOG_LEVEL: 'silent',
    DATABASE_URL: 'sqlite::memory:',
    OUTPOST_SETUP_TOKEN: TEST_SETUP_TOKEN,
    ...env,
  });
}

export function startTestApp(
  options: {
    env?: Record<string, string>;
    plugins?: readonly PluginDefinition[];
    githubEndpoints?: GithubEndpoints;
  } = {},
): Promise<FastifyInstance> {
  return buildApp(testConfig(options.env), {
    plugins: options.plugins ?? [],
    ...(options.githubEndpoints && { githubEndpoints: options.githubEndpoints }),
  });
}

/** The session cookie set by a response, as a `cookie` request header value. */
export function sessionCookie(response: LightMyRequestResponse): string {
  const cookie = response.cookies.find((candidate) => candidate.name === SESSION_COOKIE);
  if (!cookie?.value) throw new Error(`No session cookie in the response: ${response.body}`);
  return `${SESSION_COOKIE}=${cookie.value}`;
}

/** A state-changing request with the CSRF header, optionally signed in. */
export function send(
  server: FastifyInstance,
  method: 'POST' | 'PATCH' | 'DELETE',
  url: string,
  options: { body?: object; cookie?: string } = {},
) {
  return server.inject({
    method,
    url,
    ...(options.body && { payload: options.body }),
    headers: { [CSRF_HEADER]: '1', ...(options.cookie && { cookie: options.cookie }) },
  });
}

export function get(server: FastifyInstance, url: string, cookie?: string) {
  return server.inject({ method: 'GET', url, ...(cookie && { headers: { cookie } }) });
}

/** Creates the first administrator and returns the session cookie. */
export async function setUpAdmin(server: FastifyInstance, username = 'admin'): Promise<string> {
  const response = await send(server, 'POST', '/api/v1/setup', {
    body: { token: TEST_SETUP_TOKEN, username, password: TEST_PASSWORD },
  });
  if (response.statusCode !== 201) throw new Error(`Setup failed: ${response.body}`);
  return sessionCookie(response);
}
