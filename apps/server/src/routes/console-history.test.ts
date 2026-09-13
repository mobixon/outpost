import consolePlugin from '@outpost/plugin-console/server';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startFakeRconServer, type FakeRconServer } from '../connections/test-rcon-server.js';
import { createUserWithInvitation, get, send, setUpAdmin, startTestApp } from '../test-helpers.js';

interface HistoryEntry {
  id: string;
  command: string;
  uses: number;
}

let rcon: FakeRconServer;
let app: FastifyInstance | undefined;

beforeEach(async () => {
  rcon = await startFakeRconServer({ password: 'secret', reply: (command) => `ran ${command}` });
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  await rcon.close();
});

/** Commands run within the same millisecond would have no order. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 2));

async function setUp() {
  app = await startTestApp({
    env: { OUTPOST_REQUIRE_2FA_FOR_ADMINS: 'false' },
    plugins: [consolePlugin],
  });
  const server = app;
  const admin = await setUpAdmin(server);
  const addServer = async (slug: string) => {
    const created = await send(server, 'POST', '/api/v1/servers', {
      cookie: admin,
      body: { name: slug, slug, game: 'minecraft-java' },
    });
    const id = created.json<{ id: string }>().id;
    await send(server, 'PUT', `/api/v1/servers/${id}/connection`, {
      cookie: admin,
      body: { type: 'rcon', host: '127.0.0.1', port: rcon.port, password: 'secret' },
    });
    return id;
  };
  const serverId = await addServer('survival');
  const [owner, moderator] = await Promise.all([
    createUserWithInvitation(server, admin, 'the-owner', { serverId, role: 'owner' }),
    createUserWithInvitation(server, admin, 'the-moderator', { serverId, role: 'moderator' }),
  ]);
  const base = (id = serverId) => `/api/v1/servers/${id}/plugins/outpost.console`;
  const run = async (cookie: string, command: string, id = serverId) => {
    await send(server, 'POST', `${base(id)}/command`, { cookie, body: { command } });
    await tick();
  };
  const history = async (cookie: string, id = serverId) =>
    (await get(server, `${base(id)}/history`, cookie)).json<{ commands: HistoryEntry[] }>()
      .commands;
  return { server, admin, owner, moderator, addServer, base, run, history };
}

describe('the command history of the console', { timeout: 20_000 }, () => {
  it('keeps the commands of each user on each server, the last used first', async () => {
    const { server, admin, owner, moderator, addServer, base, run, history } = await setUp();
    await run(owner.cookie, 'list');
    await run(owner.cookie, 'seed');
    // Run again, also written with a slash, a command moves to the top.
    await run(owner.cookie, '/list');
    expect(await history(owner.cookie)).toMatchObject([
      { command: 'list', uses: 2 },
      { command: 'seed', uses: 1 },
    ]);

    // Every user has an own history on every server.
    expect(await history(admin)).toEqual([]);
    const creative = await addServer('creative');
    await run(admin, 'difficulty', creative);
    expect(await history(admin, creative)).toMatchObject([{ command: 'difficulty' }]);
    expect(await history(admin)).toEqual([]);

    // Without the right to run commands there is no history either.
    expect((await get(server, `${base()}/history`, moderator.cookie)).statusCode).toBe(403);
  });

  it('keeps the last 100 commands and forgets them on request', async () => {
    const { server, owner, base, run, history } = await setUp();
    for (let i = 0; i < 102; i++) await run(owner.cookie, `say ${i}`);
    const kept = await history(owner.cookie);
    expect(kept).toHaveLength(100);
    expect(kept[0]?.command).toBe('say 101');
    expect(kept.at(-1)?.command).toBe('say 2');

    const removeOne = await send(server, 'DELETE', `${base()}/history/${kept[0]?.id ?? ''}`, {
      cookie: owner.cookie,
    });
    expect(removeOne.json()).toEqual({ removed: 1 });
    expect(await history(owner.cookie)).toHaveLength(99);
    const unknown = await send(server, 'DELETE', `${base()}/history/nope`, {
      cookie: owner.cookie,
    });
    expect(unknown.statusCode).toBe(404);

    const removeAll = await send(server, 'DELETE', `${base()}/history`, { cookie: owner.cookie });
    expect(removeAll.json()).toEqual({ removed: 99 });
    expect(await history(owner.cookie)).toEqual([]);
  });
});
