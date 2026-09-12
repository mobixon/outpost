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
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const testConfig = (env: Record<string, string> = {}) =>
  loadConfig({
    NODE_ENV: 'test',
    OUTPOST_LOG_LEVEL: 'silent',
    DATABASE_URL: 'sqlite::memory:',
    ...env,
  });

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
        response: z.object({ greeting: z.string() }),
      },
      handler: ({ query }) => ({ greeting: `Hello, ${query.name}` }),
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
      handler: async () => {
        const value =
          z
            .number()
            .catch(0)
            .parse(await ctx.kv.get('counter')) + 1;
        await ctx.kv.set('counter', value);
        return { value };
      },
    });
  },
});

let app: FastifyInstance | undefined;
const start = async (plugins: readonly PluginDefinition[], env?: Record<string, string>) => {
  app = await buildApp(testConfig(env), { plugins });
  return app;
};

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('system routes', () => {
  it('reports liveness and readiness', async () => {
    const server = await start([echo]);
    expect((await server.inject('/healthz')).json()).toEqual({ status: 'ok' });
    const ready = await server.inject('/readyz');
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ready', checks: { database: true, plugins: true } });
  });

  it('lists enabled plugins', async () => {
    const server = await start([echo]);
    expect((await server.inject('/api/v1/plugins')).json()).toEqual({
      plugins: [{ id: 'test.echo', version: '1.2.3' }],
    });
  });

  it('respects OUTPOST_PLUGINS', async () => {
    const server = await start([echo], { OUTPOST_PLUGINS: '-test.echo' });
    expect((await server.inject('/api/v1/plugins')).json()).toEqual({ plugins: [] });
    expect((await server.inject('/api/v1/plugins/test.echo/greet?name=Ann')).statusCode).toBe(404);
  });

  it('publishes plugin routes in the OpenAPI document', async () => {
    const server = await start([echo]);
    const document = (await server.inject('/api/v1/openapi.json')).json<{ paths: object }>();
    expect(Object.keys(document.paths)).toContain('/api/v1/plugins/test.echo/greet');
  });

  it('answers unknown API routes with a JSON 404', async () => {
    const server = await start([echo]);
    const response = await server.inject('/api/v1/nope');
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'not_found' } });
  });
});

describe('plugin routes', () => {
  it('validates input and serializes output', async () => {
    const server = await start([echo]);
    const ok = await server.inject('/api/v1/plugins/test.echo/greet?name=Ann');
    expect(ok.json()).toEqual({ greeting: 'Hello, Ann' });

    const invalid = await server.inject('/api/v1/plugins/test.echo/greet?name=A');
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { code: 'validation_error' } });
  });

  it('maps HttpError to its status and code', async () => {
    const server = await start([echo]);
    const response = await server.inject('/api/v1/plugins/test.echo/teapot');
    expect(response.statusCode).toBe(418);
    expect(response.json()).toEqual({ error: { code: 'teapot', message: 'I am a teapot' } });
  });

  it('hides internal errors', async () => {
    const server = await start([echo]);
    const response = await server.inject('/api/v1/plugins/test.echo/boom');
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('secret internals');
    expect(response.json()).toMatchObject({ error: { code: 'internal_error' } });
  });

  it('gives plugins persistent key-value storage', async () => {
    const server = await start([echo]);
    const hit = () => server.inject({ method: 'POST', url: '/api/v1/plugins/test.echo/counter' });
    expect((await hit()).json()).toEqual({ value: 1 });
    expect((await hit()).json()).toEqual({ value: 2 });
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

    const index = await server.inject('/');
    expect(index.body).toContain('<div id="app">');
    expect(index.headers['cache-control']).toBe('no-cache');

    const clientRoute = await server.inject('/servers/1/console');
    expect(clientRoute.statusCode).toBe(200);
    expect(clientRoute.body).toContain('<div id="app">');

    const asset = await server.inject('/assets/app-1234.js');
    expect(asset.headers['cache-control']).toContain('immutable');

    expect((await server.inject('/missing.js')).statusCode).toBe(404);
    expect((await server.inject('/api/v1/nope')).headers['content-type']).toContain(
      'application/json',
    );
  });

  it('fails fast when the directory has no index.html', async () => {
    await expect(start([echo], { OUTPOST_WEB_DIR: join(webDir, 'assets') })).rejects.toThrow(
      /does not contain index.html/,
    );
  });
});
