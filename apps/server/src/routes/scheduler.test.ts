import consolePlugin from '@outpost/plugin-console/server';
import schedulerPlugin from '@outpost/plugin-scheduler/server';
import type { PluginDefinition } from '@outpost/plugin-api';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startFakeRconServer, type FakeRconServer } from '../connections/test-rcon-server.js';
import { createUserWithInvitation, get, send, setUpAdmin, startTestApp } from '../test-helpers.js';

let rcon: FakeRconServer;
let online: string[];
let app: FastifyInstance | undefined;

beforeEach(async () => {
  online = [];
  rcon = await startFakeRconServer({
    password: 'secret',
    reply: (command) =>
      command === 'list'
        ? `There are ${online.length} of a max of 20 players online: ${online.join(', ')}`
        : `ran ${command}`,
  });
});

afterEach(async () => {
  vi.useRealTimers();
  await app?.close();
  app = undefined;
  await rcon.close();
});

const saveTask = {
  name: 'Save the world',
  type: 'command',
  cron: '*/30 * * * *',
  timezone: 'Europe/Moscow',
  enabled: true,
  onlyWithPlayers: false,
  lines: ['/save-all', '', 'say saved'],
};

async function setUp(plugins: readonly PluginDefinition[] = [consolePlugin, schedulerPlugin]) {
  app = await startTestApp({ env: { OUTPOST_REQUIRE_2FA_FOR_ADMINS: 'false' }, plugins });
  const outpost = app;
  const admin = await setUpAdmin(outpost);
  const created = await send(outpost, 'POST', '/api/v1/servers', {
    cookie: admin,
    body: { name: 'Survival', slug: 'survival' },
  });
  const serverId = created.json<{ id: string }>().id;
  await send(outpost, 'PUT', `/api/v1/servers/${serverId}/connection`, {
    cookie: admin,
    body: {
      type: 'rcon',
      game: 'minecraft-java',
      host: '127.0.0.1',
      port: rcon.port,
      password: 'secret',
    },
  });
  const base = `/api/v1/servers/${serverId}/plugins/outpost.scheduler`;
  const create = (body: object, cookie = admin) =>
    send(outpost, 'POST', `${base}/tasks`, { cookie, body: { ...saveTask, ...body } });
  const run = (id: string, cookie = admin) =>
    send(outpost, 'POST', `${base}/tasks/${id}/run`, { cookie });
  const runs = (id: string, cookie = admin) =>
    get(outpost, `${base}/tasks/${id}/runs`, cookie).then(
      (response) => response.json<{ runs: Record<string, unknown>[] }>().runs,
    );
  const tasks = (cookie = admin) =>
    get(outpost, `${base}/tasks`, cookie).then(
      (response) => response.json<{ tasks: Record<string, unknown>[] }>().tasks,
    );
  return { outpost, admin, serverId, base, create, run, runs, tasks };
}

describe('scheduler', () => {
  it('creates, changes and deletes tasks', async () => {
    const { outpost, admin, serverId, base, create, tasks } = await setUp();
    const created = await create({});
    expect(created.statusCode).toBe(200);
    const task = created.json<{ id: string; nextRun: string }>();
    expect(task).toMatchObject({
      name: 'Save the world',
      lines: ['save-all', 'say saved'],
      enabled: true,
      lastRun: null,
    });
    const next = new Date(task.nextRun);
    expect(next.getTime()).toBeGreaterThan(Date.now());
    expect([0, 30]).toContain(next.getUTCMinutes());
    expect(await tasks()).toHaveLength(1);

    const disabled = await send(outpost, 'PUT', `${base}/tasks/${task.id}`, {
      cookie: admin,
      body: { ...saveTask, name: 'Save', enabled: false },
    });
    expect(disabled.json()).toMatchObject({ name: 'Save', enabled: false, nextRun: null });

    const deleted = await send(outpost, 'DELETE', `${base}/tasks/${task.id}`, { cookie: admin });
    expect(deleted.statusCode).toBe(200);
    expect(await tasks()).toEqual([]);

    const audit = await get(
      outpost,
      `/api/v1/audit?serverId=${serverId}&action=outpost.scheduler`,
      admin,
    );
    expect(
      audit
        .json<{ entries: { action: string }[] }>()
        .entries.map((entry) => entry.action)
        .sort(),
    ).toEqual([
      'outpost.scheduler.task_created',
      'outpost.scheduler.task_deleted',
      'outpost.scheduler.task_updated',
    ]);
  });

  it('rejects invalid schedules, time zones and lines', async () => {
    const { create } = await setUp();
    expect((await create({ cron: '* * * * * *' })).statusCode).toBe(400);
    expect((await create({ cron: 'daily' })).statusCode).toBe(400);
    expect((await create({ timezone: 'Mars/Olympus_Mons' })).statusCode).toBe(400);
    expect((await create({ lines: ['', '/'] })).statusCode).toBe(400);
    expect((await create({ type: 'announcement', lines: ['x'.repeat(257)] })).statusCode).toBe(400);
  });

  it('runs commands on demand and records the runs', async () => {
    const { outpost, admin, serverId, create, run, runs, tasks } = await setUp();
    const viewer = await createUserWithInvitation(outpost, admin, 'the-viewer', {
      serverId,
      role: 'viewer',
    });
    const { id } = (await create({})).json<{ id: string }>();

    expect((await run(id)).json()).toMatchObject({
      trigger: 'manual',
      status: 'ok',
      reason: null,
      output: '> save-all\nran save-all\n> say saved\nran say saved',
      triggeredBy: 'admin',
    });
    expect(rcon.commands.filter((command) => command !== 'list')).toEqual([
      'save-all',
      'say saved',
    ]);
    expect((await tasks())[0]).toMatchObject({ lastRun: { status: 'ok' } });

    // Viewers see that tasks ran, not what the server answered.
    expect(await runs(id, viewer.cookie)).toMatchObject([{ status: 'ok', output: null }]);
    expect((await run(id, viewer.cookie)).statusCode).toBe(403);

    await rcon.close();
    expect((await run(id)).json()).toMatchObject({
      status: 'skipped',
      reason: expect.any(String),
      output: null,
    });
    expect(await runs(id)).toHaveLength(2);
  });

  it('sends announcements in turn and skips them while nobody is online', async () => {
    const { create, run } = await setUp();
    const { id } = (
      await create({
        name: 'Rules',
        type: 'announcement',
        onlyWithPlayers: true,
        lines: ['&6Be nice', 'No griefing'],
      })
    ).json<{ id: string }>();

    expect((await run(id)).json()).toMatchObject({ status: 'skipped', reason: 'no_players' });
    online = ['Steve'];
    const sent = [];
    for (let index = 0; index < 3; index++) {
      sent.push((await run(id)).json<{ output: string }>().output);
    }
    expect(sent).toEqual(['&6Be nice', 'No griefing', '&6Be nice']);
    expect(rcon.commands).toContain('tellraw @a ["",{"text":"Be nice","color":"gold"}]');
  });

  it('runs the tasks on their schedule', async () => {
    const { create, runs } = await setUp();
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { id, nextRun } = (await create({ cron: '* * * * *' })).json<{
      id: string;
      nextRun: string;
    }>();
    await vi.advanceTimersByTimeAsync(new Date(nextRun).getTime() - Date.now() + 1000);
    await vi.waitFor(async () => {
      expect(await runs(id)).toMatchObject([{ trigger: 'schedule', status: 'ok' }]);
    });
  });

  it('lets task types need the permissions of the console module', async () => {
    const { outpost, admin, serverId, create } = await setUp([schedulerPlugin]);
    const owner = await createUserWithInvitation(outpost, admin, 'the-owner', {
      serverId,
      role: 'owner',
    });
    const moderator = await createUserWithInvitation(outpost, admin, 'the-moderator', {
      serverId,
      role: 'moderator',
    });
    // Without the console module, nobody but superadmins may send commands or chat messages.
    expect((await create({}, owner.cookie)).statusCode).toBe(403);
    expect((await create({ type: 'announcement' }, owner.cookie)).statusCode).toBe(403);
    expect((await create({}, moderator.cookie)).statusCode).toBe(403);
    expect((await create({})).statusCode).toBe(200);
  });
});
