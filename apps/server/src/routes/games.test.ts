import { definePlugin, PLUGIN_API_VERSION, type PluginContext } from '@outpost/plugin-api';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { get, send, setUpAdmin, startTestApp } from '../test-helpers.js';

let rustContext: PluginContext | undefined;

// A module for a game Outpost does not know, and one for any game.
const rustModule = definePlugin({
  id: 'test.rust',
  version: '1.0.0',
  apiVersion: PLUGIN_API_VERSION,
  games: ['rust'],
  permissions: [{ key: 'rust-test.use', roles: ['owner'] }],
  setup(ctx) {
    rustContext = ctx;
    ctx.http.serverRoute({
      method: 'GET',
      url: '/ping',
      permission: 'rust-test.use',
      handler: () => ({ pong: true }),
    });
  },
});
const anyGameModule = definePlugin({
  id: 'test.any',
  version: '1.0.0',
  apiVersion: PLUGIN_API_VERSION,
  permissions: [{ key: 'any-test.use', roles: ['owner'] }],
  setup(ctx) {
    ctx.http.serverRoute({
      method: 'GET',
      url: '/ping',
      permission: 'any-test.use',
      handler: () => ({ pong: true }),
    });
  },
});

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  rustContext = undefined;
});

async function setUp() {
  app = await startTestApp({
    env: { OUTPOST_REQUIRE_2FA_FOR_ADMINS: 'false' },
    plugins: [rustModule, anyGameModule],
  });
  const server = app;
  const admin = await setUpAdmin(server);
  const add = (body: object) => send(server, 'POST', '/api/v1/servers', { cookie: admin, body });
  return { server, admin, add };
}

describe('the game of a server', () => {
  it('is chosen when the server is added and never changes', async () => {
    const { server, admin, add } = await setUp();
    expect((await add({ name: 'A', slug: 'a' })).json()).toMatchObject({
      error: { code: 'validation_error' },
    });
    // Only games Outpost knows can be chosen.
    expect((await add({ name: 'A', slug: 'a', game: 'rust' })).json()).toMatchObject({
      error: { code: 'validation_error' },
    });

    const created = await add({ name: 'Survival', slug: 'survival', game: 'minecraft-java' });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ slug: 'survival', game: 'minecraft-java' });
    const id = created.json<{ id: string }>().id;

    const renamed = await send(server, 'PATCH', `/api/v1/servers/${id}`, {
      cookie: admin,
      body: { name: 'Renamed', game: 'rust' },
    });
    expect(renamed.statusCode).toBeLessThan(300);
    expect((await get(server, `/api/v1/servers/${id}`, admin)).json()).toMatchObject({
      name: 'Renamed',
      game: 'minecraft-java',
    });
  });

  it('decides which modules the server has', async () => {
    const { server, admin, add } = await setUp();
    const created = await add({ name: 'Survival', slug: 'survival', game: 'minecraft-java' });
    const id = created.json<{ id: string }>().id;

    expect((await get(server, '/api/v1/plugins', admin)).json()).toEqual({
      plugins: [
        { id: 'test.rust', version: '1.0.0', games: ['rust'] },
        { id: 'test.any', version: '1.0.0', games: null },
      ],
    });
    expect(
      (await get(server, `/api/v1/servers/${id}/plugins/test.rust/ping`, admin)).json(),
    ).toMatchObject({ error: { code: 'game_not_supported' } });
    expect(
      (await get(server, `/api/v1/servers/${id}/plugins/test.any/ping`, admin)).json(),
    ).toEqual({ pong: true });

    const context = rustContext;
    if (context === undefined) throw new Error('The test module was not set up');
    const info = await context.servers.get(id);
    if (info === undefined) throw new Error('The server is missing');
    expect(info.game).toBe('minecraft-java');
    expect(context.servers.supports(info)).toBe(false);
    expect(context.plugin.games).toEqual(['rust']);
  });
});
