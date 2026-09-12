import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  definePlugin,
  HttpError,
  PLUGIN_API_VERSION,
  type PluginContext,
  type PluginDefinition,
} from '@outpost/plugin-api';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { get, send, setUpAdmin, startTestApp } from './test-helpers.js';

const echo = definePlugin({
  id: 'test.echo',
  version: '1.2.3',
  apiVersion: PLUGIN_API_VERSION,
  setup(ctx) {
    ctx.http.route({
      method: 'GET',
      url: '/greet',
      schema: {
        querystring: z.object({ name: z.string().min(2) }),
        response: z.object({ greeting: z.string(), by: z.string() }),
      },
      handler: ({ query, user }) => ({ greeting: `Hello, ${query.name}`, by: user.username }),
    });
    ctx.http.route({
      method: 'GET',
      url: '/whoami',
      access: 'public',
      handler: ({ user }) => ({ user: user?.username ?? null }),
    });
    ctx.http.route({
      method: 'GET',
      url: '/teapot',
      handler: () => {
        throw new HttpError(418, 'teapot', 'I am a teapot');
      },
    });
    ctx.http.route({
      method: 'GET',
      url: '/boom',
      handler: () => {
        throw new Error('secret internals');
      },
    });
    ctx.http.route({
      method: 'POST',
      url: '/counter',
      schema: { response: z.object({ value: z.number() }) },
      handler: async ({ user }) => {
        const value =
          z
            .number()
            .catch(0)
            .parse(await ctx.kv.get('counter')) + 1;
        await ctx.kv.set('counter', value);
        await ctx.audit.record({ action: 'counted', userId: user.id, details: { value } });
        return { value };
      },
    });
    // Lets the tests read the audit log.
    const db = ctx.db<{ audit_log: { action: string } }>();
    ctx.http.route({
      method: 'GET',
      url: '/audit',
      handler: async () =>
        (await db.selectFrom('audit_log').select('action').execute()).map((row) => row.action),
    });
  },
});

let app: FastifyInstance | undefined;
const start = async (plugins: readonly PluginDefinition[], env: Record<string, string> = {}) => {
  app = await startTestApp({ plugins, env: { OUTPOST_REQUIRE_2FA_FOR_ADMINS: 'false', ...env } });
  return app;
};

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('system routes', () => {
  it('reports liveness and readiness without signing in', async () => {
    const server = await start([echo]);
    expect((await get(server, '/healthz')).json()).toEqual({ status: 'ok' });
    const ready = await get(server, '/readyz');
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ready', checks: { database: true, plugins: true } });
  });

  it('sends security headers', async () => {
    const server = await start([echo]);
    const response = await get(server, '/healthz');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('lists enabled plugins to signed-in users only', async () => {
    const server = await start([echo]);
    const anonymous = await get(server, '/api/v1/plugins');
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toMatchObject({ error: { code: 'unauthenticated' } });

    const cookie = await setUpAdmin(server);
    expect((await get(server, '/api/v1/plugins', cookie)).json()).toEqual({
      plugins: [{ id: 'test.echo', version: '1.2.3' }],
    });
  });

  it('respects OUTPOST_PLUGINS', async () => {
    const server = await start([echo], { OUTPOST_PLUGINS: '-test.echo' });
    const cookie = await setUpAdmin(server);
    expect((await get(server, '/api/v1/plugins', cookie)).json()).toEqual({ plugins: [] });
    expect((await get(server, '/api/v1/plugins/test.echo/whoami')).statusCode).toBe(404);
  });

  it('publishes routes in the OpenAPI document', async () => {
    const server = await start([echo]);
    const document = (await get(server, '/api/v1/openapi.json')).json<{ paths: object }>();
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining(['/api/v1/plugins/test.echo/greet', '/api/v1/auth/login']),
    );
  });

  it('answers unknown API routes with a JSON 404', async () => {
    const server = await start([echo]);
    const response = await get(server, '/api/v1/nope');
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'not_found' } });
  });
});

describe('plugin routes', () => {
  it('require a signed-in user unless they are public', async () => {
    const server = await start([echo]);
    expect((await get(server, '/api/v1/plugins/test.echo/greet?name=Ann')).statusCode).toBe(401);
    expect((await get(server, '/api/v1/plugins/test.echo/whoami')).json()).toEqual({ user: null });

    const cookie = await setUpAdmin(server);
    expect((await get(server, '/api/v1/plugins/test.echo/whoami', cookie)).json()).toEqual({
      user: 'admin',
    });
  });

  it('validate input, pass the user and serialize output', async () => {
    const server = await start([echo]);
    const cookie = await setUpAdmin(server);
    const ok = await get(server, '/api/v1/plugins/test.echo/greet?name=Ann', cookie);
    expect(ok.json()).toEqual({ greeting: 'Hello, Ann', by: 'admin' });

    const invalid = await get(server, '/api/v1/plugins/test.echo/greet?name=A', cookie);
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { code: 'validation_error' } });
  });

  it('map HttpError to its status and hide internal errors', async () => {
    const server = await start([echo]);
    const cookie = await setUpAdmin(server);
    const teapot = await get(server, '/api/v1/plugins/test.echo/teapot', cookie);
    expect(teapot.statusCode).toBe(418);
    expect(teapot.json()).toEqual({ error: { code: 'teapot', message: 'I am a teapot' } });

    const boom = await get(server, '/api/v1/plugins/test.echo/boom', cookie);
    expect(boom.statusCode).toBe(500);
    expect(boom.body).not.toContain('secret internals');
    expect(boom.json()).toMatchObject({ error: { code: 'internal_error' } });
  });

  it('give plugins key-value storage and the audit log', async () => {
    const server = await start([echo]);
    const cookie = await setUpAdmin(server);
    const hit = () => send(server, 'POST', '/api/v1/plugins/test.echo/counter', { cookie });
    expect((await hit()).json()).toEqual({ value: 1 });
    expect((await hit()).json()).toEqual({ value: 2 });
    const actions = (await get(server, '/api/v1/plugins/test.echo/audit', cookie)).json<string[]>();
    expect(actions.filter((action) => action === 'test.echo.counted')).toHaveLength(2);
  });

  it('need the CSRF header for state-changing requests', async () => {
    const server = await start([echo]);
    const cookie = await setUpAdmin(server);
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/plugins/test.echo/counter',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'csrf_header_missing' } });
  });

  it('share the general rate limit', async () => {
    const server = await start([echo]);
    const hit = () => get(server, '/api/v1/plugins/test.echo/whoami');
    const first = await hit();
    expect(first.headers['x-ratelimit-limit']).toBe('600');
    for (let i = 1; i < 600; i++) await hit();
    const limited = await hit();
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: 'rate_limited' } });
  });
});

describe('plugin lifecycle', () => {
  it('rejects route registration after setup', async () => {
    let captured: PluginContext | undefined;
    await start([
      definePlugin({
        id: 'test.late',
        version: '1.0.0',
        apiVersion: PLUGIN_API_VERSION,
        setup(ctx) {
          captured = ctx;
        },
      }),
    ]);
    expect(() => captured?.http.route({ method: 'GET', url: '/x', handler: () => ({}) })).toThrow(
      /only during setup/,
    );
  });

  it('emits startup and runs cleanups in reverse order on close', async () => {
    const calls: string[] = [];
    const first = definePlugin({
      id: 'test.first',
      version: '1.0.0',
      apiVersion: PLUGIN_API_VERSION,
      setup(ctx) {
        ctx.events.on('outpost.started', () => {
          calls.push('started');
        });
        ctx.onShutdown(() => {
          calls.push('first');
        });
      },
    });
    const second = definePlugin({
      id: 'test.second',
      version: '1.0.0',
      apiVersion: PLUGIN_API_VERSION,
      dependsOn: ['test.first'],
      setup(ctx) {
        ctx.onShutdown(() => {
          calls.push('second');
        });
      },
    });
    const server = await start([second, first]);
    expect(calls).toEqual(['started']);
    await server.close();
    app = undefined;
    expect(calls).toEqual(['started', 'second', 'first']);
  });
});

describe('web UI', () => {
  let webDir: string;

  beforeAll(() => {
    webDir = mkdtempSync(join(tmpdir(), 'outpost-web-'));
    mkdirSync(join(webDir, 'assets'));
    writeFileSync(join(webDir, 'index.html'), '<div id="app"></div>');
    writeFileSync(join(webDir, 'assets', 'app-1234.js'), 'console.log(1)');
  });

  afterAll(() => {
    rmSync(webDir, { recursive: true, force: true });
  });

  it('serves the app, falls back to index.html for client routes and caches assets', async () => {
    const server = await start([echo], { OUTPOST_WEB_DIR: webDir });

    const index = await get(server, '/');
    expect(index.body).toContain('<div id="app">');
    expect(index.headers['cache-control']).toBe('no-cache');
    expect(index.headers['content-security-policy']).toContain("script-src 'self'");

    const clientRoute = await get(server, '/servers/1/console');
    expect(clientRoute.statusCode).toBe(200);
    expect(clientRoute.body).toContain('<div id="app">');

    const asset = await get(server, '/assets/app-1234.js');
    expect(asset.headers['cache-control']).toContain('immutable');

    expect((await get(server, '/missing.js')).statusCode).toBe(404);
    expect((await get(server, '/api/v1/nope')).headers['content-type']).toContain(
      'application/json',
    );

    // Regression: registering the web UI must not leave earlier routes with Fastify's default
    // error format.
    const login = await send(server, 'POST', '/api/v1/auth/login', {
      body: { username: 'nobody', password: 'wrong password' },
    });
    expect(login.json()).toEqual({
      error: { code: 'invalid_credentials', message: 'Wrong username or password' },
    });
  });

  it('fails fast when the directory has no index.html', async () => {
    await expect(start([echo], { OUTPOST_WEB_DIR: join(webDir, 'assets') })).rejects.toThrow(
      /does not contain index.html/,
    );
  });
});
