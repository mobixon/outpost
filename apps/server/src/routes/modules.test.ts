import { definePlugin, PLUGIN_API_VERSION } from '@outpost/plugin-api';
import consolePlugin from '@outpost/plugin-console/server';
import { createPlayersPlugin } from '@outpost/plugin-players/server';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startFakeRconServer, type FakeRconServer } from '../connections/test-rcon-server.js';
import { createUserWithInvitation, get, send, setUpAdmin, startTestApp } from '../test-helpers.js';

// A module of Minecraft servers that can be switched off, and one that belongs to no server.
const greeter = definePlugin({
  id: 'test.greeter',
  version: '1.0.0',
  apiVersion: PLUGIN_API_VERSION,
  games: ['minecraft-java'],
  permissions: [{ key: 'greeter.use', roles: ['owner', 'admin', 'moderator', 'viewer'] }],
  setup(ctx) {
    ctx.http.serverRoute({
      method: 'GET',
      url: '/hello',
      permission: 'greeter.use',
      handler: () => ({ hello: true }),
    });
  },
});
// A module that is off until an owner switches it on.
const optIn = definePlugin({
  id: 'test.opt-in',
  version: '1.0.0',
  apiVersion: PLUGIN_API_VERSION,
  games: ['minecraft-java'],
  defaultEnabled: false,
  permissions: [{ key: 'optin.use', roles: ['owner', 'admin', 'moderator', 'viewer'] }],
  setup(ctx) {
    ctx.http.serverRoute({
      method: 'GET',
      url: '/hello',
      permission: 'optin.use',
      handler: () => ({ hello: 'opt-in' }),
    });
  },
});
const global = definePlugin({
  id: 'test.global',
  version: '1.0.0',
  apiVersion: PLUGIN_API_VERSION,
});

let app: FastifyInstance | undefined;
let rcon: FakeRconServer;

beforeEach(async () => {
  rcon = await startFakeRconServer({
    password: 'pw',
    reply: (command) =>
      command.startsWith('list') ? 'There are 0 of a max of 20 players online: ' : '',
  });
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  await rcon.close();
});

async function setUp() {
  app = await startTestApp({
    env: { OUTPOST_REQUIRE_2FA_FOR_ADMINS: 'false' },
    plugins: [consolePlugin, greeter, optIn, global, createPlayersPlugin({ pollIntervalMs: 50 })],
  });
  const server = app;
  const admin = await setUpAdmin(server);
  const created = await send(server, 'POST', '/api/v1/servers', {
    cookie: admin,
    body: { name: 'Survival', slug: 'survival', game: 'minecraft-java' },
  });
  const serverId = created.json<{ id: string }>().id;
  const owner = await createUserWithInvitation(server, admin, 'the-owner', {
    serverId,
    role: 'owner',
  });
  const moderator = await createUserWithInvitation(server, admin, 'the-mod', {
    serverId,
    role: 'moderator',
  });
  const base = `/api/v1/servers/${serverId}`;
  const setModule = (id: string, enabled: boolean, cookie = owner.cookie) =>
    send(server, 'PUT', `${base}/modules/${id}`, { cookie, body: { enabled } });
  return { server, admin, owner, moderator, serverId, base, setModule };
}

describe('the modules of a server', () => {
  it('are listed for the game of the server, and the essential ones cannot be switched off', async () => {
    const { server, owner, base, setModule } = await setUp();
    const list = await get(server, `${base}/modules`, owner.cookie);
    expect(list.json()).toEqual({
      modules: [
        { id: 'outpost.console', version: expect.any(String), essential: true, enabled: true },
        { id: 'test.greeter', version: '1.0.0', essential: false, enabled: true },
        { id: 'test.opt-in', version: '1.0.0', essential: false, enabled: false },
        { id: 'outpost.players', version: expect.any(String), essential: false, enabled: true },
      ],
    });
    const essential = await setModule('outpost.console', false);
    expect(essential.statusCode).toBe(409);
    expect(essential.json()).toMatchObject({ error: { code: 'module_essential' } });
    expect((await setModule('test.global', false)).statusCode).toBe(404);
    expect((await setModule('nope', false)).statusCode).toBe(404);
  });

  it('can be off until an owner switches them on', async () => {
    const { server, owner, base, setModule } = await setUp();
    const url = `${base}/plugins/test.opt-in/hello`;
    // A new server has the module off: no tab, no answer.
    expect((await get(server, base, owner.cookie)).json()).toMatchObject({
      disabledModules: ['test.opt-in'],
    });
    const off = await get(server, url, owner.cookie);
    expect(off.statusCode).toBe(409);
    expect(off.json()).toMatchObject({ error: { code: 'module_disabled' } });

    expect((await setModule('test.opt-in', true)).json()).toMatchObject({ enabled: true });
    expect((await get(server, base, owner.cookie)).json()).toMatchObject({ disabledModules: [] });
    expect((await get(server, url, owner.cookie)).json()).toEqual({ hello: 'opt-in' });

    // Switched off again, it is off by choice.
    await setModule('test.opt-in', false);
    expect((await get(server, url, owner.cookie)).statusCode).toBe(409);
  });

  it('are switched on and off by the owners of the server, and the change is audited', async () => {
    const { server, admin, owner, moderator, base, serverId, setModule } = await setUp();
    expect((await setModule('test.greeter', false, moderator.cookie)).statusCode).toBe(403);

    const off = await setModule('test.greeter', false);
    expect(off.json()).toMatchObject({ id: 'test.greeter', enabled: false });
    const summary = (await get(server, base, owner.cookie)).json<{ disabledModules: string[] }>();
    expect(summary.disabledModules).toEqual(['test.greeter', 'test.opt-in']);
    // Everyone sees which are off; the list of modules says it too.
    expect(
      (await get(server, base, moderator.cookie)).json<{ disabledModules: string[] }>()
        .disabledModules,
    ).toEqual(['test.greeter', 'test.opt-in']);
    expect(
      (await get(server, `${base}/modules`, moderator.cookie))
        .json<{ modules: { id: string; enabled: boolean }[] }>()
        .modules.find((module) => module.id === 'test.greeter')?.enabled,
    ).toBe(false);

    const on = await setModule('test.greeter', true);
    expect(on.json()).toMatchObject({ enabled: true });
    expect((await get(server, base, owner.cookie)).json()).toMatchObject({
      disabledModules: ['test.opt-in'],
    });

    const audit = await get(server, `/api/v1/servers/${serverId}/audit`, owner.cookie);
    const actions = audit.json<{ entries: { action: string; target: string | null }[] }>().entries;
    expect(
      actions
        .filter((entry) => entry.action.startsWith('server.module_'))
        .map((entry) => [entry.action, entry.target]),
    ).toEqual([
      ['server.module_enabled', 'test.greeter'],
      ['server.module_disabled', 'test.greeter'],
    ]);
    expect(admin).toBeTruthy();
  });

  it('do not answer while they are off, and answer again when they are back on', async () => {
    const { server, owner, base, setModule } = await setUp();
    const url = `${base}/plugins/test.greeter/hello`;
    expect((await get(server, url, owner.cookie)).json()).toEqual({ hello: true });
    await setModule('test.greeter', false);
    const off = await get(server, url, owner.cookie);
    expect(off.statusCode).toBe(409);
    expect(off.json()).toMatchObject({ error: { code: 'module_disabled' } });
    await setModule('test.greeter', true);
    expect((await get(server, url, owner.cookie)).json()).toEqual({ hello: true });
  });

  it('do not ask the game server anything while they are off', async () => {
    const { server, admin, serverId, setModule } = await setUp();
    const connected = await send(server, 'PUT', `/api/v1/servers/${serverId}/connection`, {
      cookie: admin,
      body: { type: 'rcon', host: '127.0.0.1', port: rcon.port, password: 'pw' },
    });
    expect(connected.statusCode).toBe(204);
    const polls = () => rcon.commands.filter((command) => command.startsWith('list')).length;

    // The Players module asks who is online every 50 ms in this test.
    await vi.waitFor(() => expect(polls()).toBeGreaterThan(2), { timeout: 5000, interval: 50 });
    await setModule('outpost.players', false);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const before = polls();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(polls()).toBe(before);

    await setModule('outpost.players', true);
    await vi.waitFor(() => expect(polls()).toBeGreaterThan(before), {
      timeout: 5000,
      interval: 50,
    });
  });
});
