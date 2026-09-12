import consolePlugin from '@outpost/plugin-console/server';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closedPort,
  startFakeRconServer,
  type FakeRconServer,
} from '../connections/test-rcon-server.js';
import { createUserWithInvitation, get, send, setUpAdmin, startTestApp } from '../test-helpers.js';

const password = 'rcon-secret';
let rcon: FakeRconServer;
let app: FastifyInstance | undefined;

beforeEach(async () => {
  rcon = await startFakeRconServer({
    password,
    reply: (command) => {
      if (command === 'list') return 'There are 1 of a max of 20 players online: Steve';
      if (command.startsWith('tellraw')) return '';
      return `ran ${command}`;
    },
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
    plugins: [consolePlugin],
  });
  const server = app;
  const admin = await setUpAdmin(server);
  const created = await send(server, 'POST', '/api/v1/servers', {
    cookie: admin,
    body: { name: 'Survival', slug: 'survival' },
  });
  const serverId = created.json<{ id: string }>().id;
  const member = (username: string, role: string) =>
    createUserWithInvitation(server, admin, username, { serverId, role });
  const [owner, moderator, viewer] = await Promise.all([
    member('the-owner', 'owner'),
    member('the-moderator', 'moderator'),
    member('the-viewer', 'viewer'),
  ]);
  const connection = (port = rcon.port, secret: string | null = password) => ({
    type: 'rcon',
    game: 'minecraft-java',
    host: '127.0.0.1',
    port,
    ...(secret !== null && { password: secret }),
  });
  const connect = (body = connection()) =>
    send(server, 'PUT', `/api/v1/servers/${serverId}/connection`, { cookie: admin, body });
  return { server, admin, serverId, owner, moderator, viewer, connection, connect };
}

describe('server connections', () => {
  it('are managed by superadmins, and the password never leaves the server', async () => {
    const { server, admin, serverId, owner, connection, connect } = await setUp();
    const path = `/api/v1/servers/${serverId}/connection`;

    const byOwner = await send(server, 'PUT', path, { cookie: owner.cookie, body: connection() });
    expect(byOwner.json()).toMatchObject({ error: { code: 'forbidden' } });
    expect((await get(server, path, owner.cookie)).statusCode).toBe(403);
    const withoutPassword = await connect(connection(rcon.port, null));
    expect(withoutPassword.json()).toMatchObject({ error: { code: 'rcon_password_required' } });

    expect((await connect()).statusCode).toBe(204);
    const stored = await get(server, path, admin);
    expect(stored.json()).toEqual({
      connection: {
        type: 'rcon',
        game: 'minecraft-java',
        host: '127.0.0.1',
        port: rcon.port,
        hasPassword: true,
      },
    });
    expect(stored.body).not.toContain(password);
    expect((await get(server, `/api/v1/servers/${serverId}`, owner.cookie)).json()).toMatchObject({
      connected: true,
      connectionType: 'rcon',
      game: 'minecraft-java',
      capabilities: ['commands.send'],
    });

    // Saving without a password keeps the stored one.
    expect((await connect(connection(rcon.port, null))).statusCode).toBe(204);
    expect(
      (await get(server, `/api/v1/servers/${serverId}/status`, owner.cookie)).json(),
    ).toMatchObject({
      reachable: true,
    });

    const audit = await get(
      server,
      `/api/v1/audit?serverId=${serverId}&action=server.connection`,
      admin,
    );
    expect(audit.body).not.toContain(password);
    expect(audit.json()).toMatchObject({
      entries: [{ action: 'server.connection_updated' }, { action: 'server.connection_updated' }],
    });

    expect((await send(server, 'DELETE', path, { cookie: admin })).statusCode).toBe(204);
    expect((await get(server, `/api/v1/servers/${serverId}`, owner.cookie)).json()).toMatchObject({
      connected: false,
      capabilities: [],
    });
  });

  it('are tested step by step before saving', async () => {
    const { server, admin, serverId, connection } = await setUp();
    const test = (body: object) =>
      send(server, 'POST', `/api/v1/servers/${serverId}/connection/test`, { cookie: admin, body });

    const ok = (await test(connection())).json<{ ok: boolean; steps: { detail: string }[] }>();
    expect(ok.ok).toBe(true);
    expect(ok.steps[2]?.detail).toBe('There are 1 of a max of 20 players online: Steve');
    expect((await test(connection(rcon.port, 'wrong'))).json()).toMatchObject({
      ok: false,
      steps: [{ ok: true }, { ok: false, error: 'auth_failed' }, { ok: null }],
    });
    expect((await test(connection(await closedPort()))).json()).toMatchObject({
      ok: false,
      steps: [{ ok: false, error: 'connection_refused' }, { ok: null }, { ok: null }],
    });
    expect((await test(connection(rcon.port, null))).json()).toMatchObject({
      error: { code: 'rcon_password_required' },
    });
  });

  it('report the status with the players online to every member', async () => {
    const { server, serverId, viewer, connect } = await setUp();
    const status = () => get(server, `/api/v1/servers/${serverId}/status`, viewer.cookie);
    expect((await status()).json()).toMatchObject({ reachable: null, players: null });
    await connect();
    expect((await status()).json()).toMatchObject({
      reachable: true,
      error: null,
      players: { online: 1, max: 20, names: ['Steve'] },
    });
  });
});

describe('console', () => {
  it('runs commands for owners and admins and sends chat for moderators', async () => {
    const { server, admin, serverId, owner, moderator, viewer, connect } = await setUp();
    await connect();
    const base = `/api/v1/servers/${serverId}/plugins/outpost.console`;

    const ran = await send(server, 'POST', `${base}/command`, {
      cookie: owner.cookie,
      body: { command: '/say hi' },
    });
    expect(ran.json()).toEqual({ reply: 'ran say hi' });
    const byModerator = await send(server, 'POST', `${base}/command`, {
      cookie: moderator.cookie,
      body: { command: 'op the-moderator' },
    });
    expect(byModerator.statusCode).toBe(403);

    const chat = await send(server, 'POST', `${base}/chat`, {
      cookie: moderator.cookie,
      body: { message: 'hello "all"' },
    });
    expect(chat.statusCode).toBe(200);
    const tellraw = rcon.commands.find((command) => command.startsWith('tellraw'));
    expect(JSON.parse(tellraw?.slice('tellraw @a '.length) ?? '[]')).toEqual([
      { text: '[Web] ', color: 'gray' },
      { text: 'the-moderator: ', color: 'aqua' },
      { text: 'hello "all"' },
    ]);
    expect(
      (
        await send(server, 'POST', `${base}/chat`, {
          cookie: viewer.cookie,
          body: { message: 'x' },
        })
      ).statusCode,
    ).toBe(403);
    expect(rcon.commands).not.toContain('op the-moderator');

    const audit = await get(
      server,
      `/api/v1/audit?serverId=${serverId}&action=outpost.console`,
      admin,
    );
    expect(audit.json()).toMatchObject({
      entries: [
        {
          action: 'outpost.console.chat',
          username: 'the-moderator',
          details: { message: 'hello "all"' },
        },
        {
          action: 'outpost.console.command',
          username: 'the-owner',
          details: { command: 'say hi', ok: true },
        },
      ],
    });
  });

  it('explains missing connections, unreachable servers and long commands', async () => {
    const { server, admin, serverId, owner, connect, connection } = await setUp();
    const command = (text: string) =>
      send(server, 'POST', `/api/v1/servers/${serverId}/plugins/outpost.console/command`, {
        cookie: owner.cookie,
        body: { command: text },
      });

    expect((await command('list')).json()).toMatchObject({ error: { code: 'capability_missing' } });
    await connect(connection(await closedPort()));
    const refused = await command('list');
    expect(refused.statusCode).toBe(502);
    expect(refused.json()).toMatchObject({ error: { code: 'connection_refused' } });
    expect(
      (
        await get(server, `/api/v1/audit?serverId=${serverId}&action=outpost.console`, admin)
      ).json(),
    ).toMatchObject({ entries: [{ details: { command: 'list', ok: false } }] });

    await connect(connection());
    expect((await command(`say ${'ж'.repeat(800)}`)).json()).toMatchObject({
      error: { code: 'command_too_long' },
    });
    expect((await command('list')).json()).toEqual({
      reply: 'There are 1 of a max of 20 players online: Steve',
    });
  });
});
