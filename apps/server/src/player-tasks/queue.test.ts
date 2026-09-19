import { PlayerTaskError, type PlayerTask, type PlayerTasks } from '@outpost/plugin-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase, type Database } from '../db/connection.js';
import { CORE_SCOPE, coreMigrations } from '../db/core-migrations.js';
import { runMigrations } from '../db/migrator.js';
import { PlayerTaskQueue } from './queue.js';

const silent = { info: () => {}, warn: () => {}, error: () => {} };
const STEVE = '069a79f4-44e9-4726-a5be-fca90e38aaf5';

let database: Database;
let online: string[];
let queue: PlayerTaskQueue;
let tasks: PlayerTasks;
let setup: boolean;

beforeEach(async () => {
  database = createDatabase('sqlite::memory:');
  await runMigrations(database.db, database.dialect, CORE_SCOPE, coreMigrations, silent);
  const now = Date.now();
  await database.db
    .insertInto('servers')
    .values({
      id: 's1',
      slug: 'survival',
      name: 'Survival',
      game: 'minecraft-java',
      connection: null,
      files: null,
      created_at: now,
      updated_at: now,
    })
    .execute();
  online = [];
  setup = true;
  queue = new PlayerTaskQueue({
    db: database.db,
    send: async () =>
      `There are ${online.length} of a max of 20 players online: ${online.join(', ')}`,
    canTell: async () => true,
  });
  tasks = queue.forPlugin('test.plugin', () => setup);
});

afterEach(async () => {
  vi.useRealTimers();
  await database.db.destroy();
});

const add = (kind = 'reward', name = 'Steve') =>
  tasks.enqueue({ serverId: 's1', playerUuid: STEVE, playerName: name, kind, payload: { n: 1 } });
const statusOf = async (id: string) =>
  (await tasks.list({ serverId: 's1' })).find((task) => task.id === id)?.status;

describe('PlayerTaskQueue', () => {
  it('waits for the player, then runs the handler once', async () => {
    const seen: PlayerTask[] = [];
    tasks.handle('reward', (task) => void seen.push(task));
    setup = false;
    const task = await add();

    await queue.sweep();
    expect(seen).toEqual([]);

    online = ['steve'];
    await queue.sweep();
    await queue.sweep();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ playerName: 'Steve', kind: 'reward', payload: { n: 1 } });
    expect(await statusOf(task.id)).toBe('done');
  });

  it('runs at once when a plugin says the player joined', async () => {
    const seen: string[] = [];
    tasks.handle('reward', (task) => void seen.push(task.playerName));
    await add();
    tasks.playerJoined('s1', 'STEVE');
    await vi.waitFor(() => expect(seen).toEqual(['Steve']));
  });

  it('tries again after a failure, and gives up after five', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let calls = 0;
    tasks.handle('reward', () => {
      calls++;
      throw new Error('no luck');
    });
    online = ['Steve'];
    const task = await add();
    for (let attempt = 1; attempt <= 5; attempt++) {
      await queue.sweep();
      expect(calls).toBe(attempt);
      // Waits longer after every failure.
      vi.setSystemTime(Date.now() + attempt * 30_000 + 1);
    }
    const [failed] = await tasks.list({ serverId: 's1' });
    expect(failed).toMatchObject({ id: task.id, status: 'failed', attempts: 5, error: 'no luck' });
    await queue.sweep();
    expect(calls).toBe(5);

    expect(await tasks.retry(task.id)).toBe(true);
    expect(await statusOf(task.id)).toBe('pending');
  });

  it('gives up at once for an error that another attempt would not fix', async () => {
    tasks.handle('reward', () => {
      throw new PlayerTaskError('bad command');
    });
    online = ['Steve'];
    const task = await add();
    await queue.sweep();
    expect(await statusOf(task.id)).toBe('failed');
    expect(await tasks.retry(task.id)).toBe(true);
  });

  it('keeps the tasks of a kind nobody handles, and cancels on request', async () => {
    online = ['Steve'];
    const waiting = await add('unhandled');
    await queue.sweep();
    expect(await statusOf(waiting.id)).toBe('pending');
    expect(await tasks.cancel(waiting.id)).toBe(true);
    expect(await tasks.cancel(waiting.id)).toBe(false);
    expect(await statusOf(waiting.id)).toBe('cancelled');
  });

  it('keeps the tasks of one plugin from another', async () => {
    const other = queue.forPlugin('other.plugin', () => false);
    const task = await add();
    expect(await other.list({ serverId: 's1' })).toEqual([]);
    expect(await other.cancel(task.id)).toBe(false);
    expect(await statusOf(task.id)).toBe('pending');
  });

  it('refuses names and UUIDs that are not a player', async () => {
    await expect(add('reward', 'Steve; op Steve')).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      tasks.enqueue({
        serverId: 's1',
        playerUuid: 'x',
        playerName: 'Steve',
        kind: 'k',
        payload: 1,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('accepts handlers only during setup, once per kind', () => {
    tasks.handle('a', () => undefined);
    expect(() => tasks.handle('a', () => undefined)).toThrow(/twice/);
    setup = false;
    expect(() => tasks.handle('b', () => undefined)).toThrow(/only during setup/);
  });
});
