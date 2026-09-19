import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCompetitionsPlugin } from '@outpost/plugin-competitions/server';
import consolePlugin from '@outpost/plugin-console/server';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startFakeRconServer, type FakeRconServer } from '../connections/test-rcon-server.js';
import { createUserWithInvitation, get, send, setUpAdmin, startTestApp } from '../test-helpers.js';

const STEVE = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
const ALEX = '61699b2e-d327-3a92-a2bb-67c4ca2c2d00';
const NEWBIE = 'b1d1a2c3-0000-4000-8000-000000000003';
const OPERATOR = 'c2e2b3d4-0000-4000-8000-000000000004';

const password = 'rcon-secret';
let rcon: FakeRconServer;
let root: string;
let app: FastifyInstance | undefined;

beforeEach(async () => {
  rcon = await startFakeRconServer({
    password,
    reply: (command) => (command === 'list' ? 'There are 0 of a max of 20 players online: ' : ''),
  });
  root = await mkdtemp(path.join(tmpdir(), 'outpost-competitions-'));
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  await rcon.close();
  await rm(root, { recursive: true, force: true });
});

const folder = () => path.join(root, 'survival');
let clock = Date.now();

/** Writes the statistics of a player as the game does; every write gets a new modification time. */
async function writeStats(uuid: string, mined: Record<string, number>): Promise<void> {
  const file = path.join(folder(), 'world', 'stats', `${uuid}.json`);
  await writeFile(file, JSON.stringify({ stats: { 'minecraft:mined': mined }, DataVersion: 1 }));
  clock += 5000;
  await utimes(file, new Date(clock), new Date(clock));
}

const log = (text: string) =>
  appendFile(
    path.join(folder(), 'logs', 'latest.log'),
    `[12:00:00] [Server thread/INFO]: ${text}\n`,
  );

async function setUp() {
  await mkdir(path.join(folder(), 'world', 'stats'), { recursive: true });
  await mkdir(path.join(folder(), 'logs'));
  await writeFile(path.join(folder(), 'server.properties'), 'level-name=world\n');
  await writeFile(path.join(folder(), 'logs', 'latest.log'), '');
  await writeFile(
    path.join(folder(), 'usercache.json'),
    JSON.stringify([
      { name: 'Steve', uuid: STEVE },
      { name: 'Alex', uuid: ALEX },
      { name: 'Newbie', uuid: NEWBIE },
      { name: 'Boss', uuid: OPERATOR },
    ]),
  );
  await writeFile(
    path.join(folder(), 'ops.json'),
    JSON.stringify([{ name: 'Boss', uuid: OPERATOR }]),
  );
  await writeStats(STEVE, { 'minecraft:oak_log': 10, 'minecraft:stone': 999 });
  await writeStats(ALEX, { 'minecraft:birch_log': 5 });
  await writeStats(OPERATOR, { 'minecraft:oak_log': 1 });

  app = await startTestApp({
    env: { OUTPOST_REQUIRE_2FA_FOR_ADMINS: 'false', OUTPOST_FILES_ROOT: root },
    plugins: [
      consolePlugin,
      createCompetitionsPlugin({
        engine: { tickMs: 200, countIntervalMs: 300 },
        triggers: { askCooldownMs: 0, joinDelayMs: 50 },
      }),
    ],
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
  const viewer = await createUserWithInvitation(server, admin, 'the-viewer', {
    serverId,
    role: 'viewer',
  });
  const connected = [
    await send(server, 'PUT', `/api/v1/servers/${serverId}/connection`, {
      cookie: admin,
      body: { type: 'rcon', host: '127.0.0.1', port: rcon.port, password },
    }),
    await send(server, 'PUT', `/api/v1/servers/${serverId}/files`, {
      cookie: admin,
      body: { source: 'folder', path: 'survival', writable: false },
    }),
  ];
  expect(connected.map((response) => response.statusCode)).toEqual([204, 204]);
  const url = `/api/v1/servers/${serverId}/plugins/outpost.competitions`;
  return { server, admin, owner, viewer, serverId, url };
}

function definition(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Wood week',
    timezone: 'UTC',
    startsAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + 6000).toISOString(),
    metric: { kind: 'mined', presets: ['wood'], blocks: [] },
    scoring: { kind: 'sum' },
    participants: { top: 3, excludeOperators: true, excluded: [] },
    rewards: {
      places: [
        { place: 1, commands: ['give {player} diamond 5', 'say {player} won {event} ({place})'] },
        { place: 2, commands: ['xp add {player} 5 levels'] },
      ],
    },
    messages: {
      command: '!top',
      description: '&7Cut the most trees!',
      top: '&6{event}&r\n{description}\n{top}\n{your_place} {your_score}',
      entry: '{place}. {name} - {score}',
      joinNotice: true,
      join: '{event} ends in {ends_in}',
      announceResults: true,
      results: '{event} is over!\n{top}',
      reward: '{event}: place {place}, {score} logs',
    },
    ...overrides,
  };
}

interface Detail {
  event: { state: string; problem: string | null; baselineAt: string | null; rewards: unknown };
  standings: { place: number; name: string; score: number }[];
  countedAt: string | null;
  rewards: { place: number; playerName: string; command: string; status: string }[];
}

describe('competitions', () => {
  it('count the growth of a counter, answer players and hand out rewards', async () => {
    const { server, owner, viewer, url } = await setUp();

    const created = await send(server, 'POST', `${url}/events`, {
      cookie: owner.cookie,
      body: definition(),
    });
    expect(created.statusCode).toBe(200);
    const id = created.json<{ id: string }>().id;
    const detail = async (cookie = owner.cookie) =>
      (await get(server, `${url}/events/${id}`, cookie)).json<Detail>();

    // The counters at the start are taken when it begins.
    await vi.waitFor(async () => expect((await detail()).countedAt).not.toBeNull(), {
      timeout: 5000,
      interval: 100,
    });
    expect((await detail()).event.state).toBe('active');
    expect((await detail()).standings).toEqual([]);
    expect(rcon.commands).toContain('save-all flush');

    // Steve cut 15 logs (and mined stone, which does not count), Alex 4, Newbie is new with 3;
    // the operator cut a lot but does not take part.
    await writeStats(STEVE, { 'minecraft:oak_log': 25, 'minecraft:stone': 2000 });
    await writeStats(ALEX, { 'minecraft:birch_log': 9 });
    await writeStats(NEWBIE, { 'minecraft:cherry_log': 3, 'minecraft:oak_wood': 0 });
    await writeStats(OPERATOR, { 'minecraft:oak_log': 500 });
    await vi.waitFor(
      async () =>
        expect((await detail()).standings.map(({ name, score }) => [name, score])).toEqual([
          ['Steve', 15],
          ['Alex', 4],
          ['Newbie', 3],
        ]),
      { timeout: 5000, interval: 100 },
    );

    // People without the right to manage do not see the commands of the rewards.
    const seen = await detail(viewer.cookie);
    expect(seen.event.rewards).toEqual({
      places: [
        { place: 1, commands: [] },
        { place: 2, commands: [] },
      ],
    });

    // The chat command is answered to the player who typed it, with the place of that player.
    await vi.waitFor(
      async () => {
        await log('<Alex> !top');
        await new Promise((resolve) => setTimeout(resolve, 1300));
        expect(rcon.commands.some((command) => command.startsWith('tellraw Alex'))).toBe(true);
      },
      { timeout: 15_000, interval: 50 },
    );
    const answer = rcon.commands.filter((command) => command.startsWith('tellraw Alex')).join('\n');
    // Every answer is one command, not one per line.
    for (const command of rcon.commands.filter((entry) => entry.startsWith('tellraw Alex'))) {
      expect(command).toContain('1. Steve - 15');
      expect(command).toContain('#2 4');
    }
    expect(answer).toContain('1. Steve - 15');
    expect(answer).toContain('#2 4');
    expect(answer).toContain('Cut the most trees!');

    // A player who joins is told about it.
    await log('Newbie joined the game');
    await vi.waitFor(
      () =>
        expect(
          rcon.commands.some(
            (command) => command.startsWith('tellraw Newbie') && command.includes('ends in'),
          ),
        ).toBe(true),
      { timeout: 5000, interval: 100 },
    );

    // At the end the result is frozen and told to everyone.
    await vi.waitFor(async () => expect((await detail()).event.state).toBe('finished'), {
      timeout: 15_000,
      interval: 100,
    });
    expect((await detail()).standings.map(({ name, score }) => [name, score])).toEqual([
      ['Steve', 15],
      ['Alex', 4],
      ['Newbie', 3],
    ]);
    await vi.waitFor(
      () =>
        expect(
          rcon.commands.some(
            (command) => command.startsWith('tellraw @a') && command.includes('is over!'),
          ),
        ).toBe(true),
      { timeout: 5000, interval: 100 },
    );

    // The winners get their commands when they are online: the rewards wait until they join.
    const rewards = (await detail()).rewards;
    expect(
      rewards.map(({ place, playerName, command, status }) => [place, playerName, command, status]),
    ).toEqual([
      [1, 'Steve', 'give {player} diamond 5', 'pending'],
      [1, 'Steve', 'say {player} won {event} ({place})', 'pending'],
      [2, 'Alex', 'xp add {player} 5 levels', 'pending'],
    ]);
    await vi.waitFor(
      async () => {
        await log('Steve joined the game');
        await new Promise((resolve) => setTimeout(resolve, 1300));
        expect(rcon.commands).toContain('give Steve diamond 5');
      },
      { timeout: 15_000, interval: 50 },
    );
    await vi.waitFor(async () => expect(rcon.commands).toContain('say Steve won Wood week (1)'), {
      timeout: 5000,
      interval: 100,
    });
    await vi.waitFor(
      async () =>
        expect(
          (await detail()).rewards.map(({ playerName, status }) => [playerName, status]),
        ).toEqual([
          ['Steve', 'done'],
          ['Steve', 'done'],
          ['Alex', 'pending'],
        ]),
      { timeout: 5000, interval: 100 },
    );
    expect(rcon.commands.some((command) => command.startsWith('xp add Alex'))).toBe(false);
    expect(
      rcon.commands.some(
        (command) => command.startsWith('tellraw Steve') && command.includes('place 1'),
      ),
    ).toBe(true);
  }, 60_000);

  it('are checked before they are saved', async () => {
    const { server, owner, viewer, url } = await setUp();
    const post = (body: object, cookie = owner.cookie) =>
      send(server, 'POST', `${url}/events`, { cookie, body });

    const unknown = await post(
      definition({
        messages: { ...definition().messages, join: '{event} {nope}' },
        rewards: { places: [{ place: 4, commands: ['say {who}'] }] },
      }),
    );
    expect(unknown.statusCode).toBe(400);
    expect(
      (
        await post(
          definition({
            startsAt: new Date(Date.now() - 2000).toISOString(),
            endsAt: new Date(Date.now() - 1000).toISOString(),
          }),
        )
      ).json(),
    ).toMatchObject({ error: { code: 'invalid_period' } });
    expect(
      (await post(definition({ startsAt: '2026-01-02T00:00:00Z', endsAt: '2026-01-01T00:00:00Z' })))
        .statusCode,
    ).toBe(400);
    expect((await post(definition(), viewer.cookie)).statusCode).toBe(403);

    // What is counted can also be the fish caught, which needs no blocks.
    expect((await post(definition({ metric: { kind: 'fish_caught' } }))).statusCode).toBe(200);

    // A future competition can be changed and deleted; running ones must be cancelled first.
    const future = definition({
      startsAt: new Date(Date.now() + 3_600_000).toISOString(),
      endsAt: new Date(Date.now() + 7_200_000).toISOString(),
    });
    const created = await post(future);
    expect(created.statusCode).toBe(200);
    const id = created.json<{ id: string }>().id;
    const changed = await send(server, 'PUT', `${url}/events/${id}`, {
      cookie: owner.cookie,
      body: { ...future, name: 'Renamed' },
    });
    expect(changed.json()).toMatchObject({ name: 'Renamed', state: 'scheduled' });
    const cancelled = await send(server, 'POST', `${url}/events/${id}/cancel`, {
      cookie: owner.cookie,
    });
    expect(cancelled.json()).toMatchObject({ state: 'cancelled' });
    expect(
      (await send(server, 'PUT', `${url}/events/${id}`, { cookie: owner.cookie, body: future }))
        .statusCode,
    ).toBe(409);
    expect(
      (await send(server, 'DELETE', `${url}/events/${id}`, { cookie: owner.cookie })).json(),
    ).toEqual({
      deleted: true,
    });
    expect((await get(server, `${url}/events/${id}`, owner.cookie)).statusCode).toBe(404);
  });

  it('announce by themselves, count on request and test the commands of rewards', async () => {
    const { server, owner, viewer, url } = await setUp();
    const created = await send(server, 'POST', `${url}/events`, {
      cookie: owner.cookie,
      body: definition({
        endsAt: new Date(Date.now() + 60_000).toISOString(),
        announcements: [
          { anchor: 'start', minutesBefore: 0, text: '&6{event} is on! Type {command}' },
          { anchor: 'start', minutesBefore: 10, text: 'too early to be sent' },
        ],
      }),
    });
    expect(created.statusCode).toBe(200);
    const id = created.json<{ id: string }>().id;
    const detail = async () =>
      (await get(server, `${url}/events/${id}`, owner.cookie)).json<Detail>();
    await vi.waitFor(async () => expect((await detail()).countedAt).not.toBeNull(), {
      timeout: 5000,
      interval: 100,
    });

    // The message of the start goes out once; the one for ten minutes before is already late.
    await vi.waitFor(
      () =>
        expect(
          rcon.commands.filter(
            (command) => command.startsWith('tellraw @a') && command.includes('Wood week is on!'),
          ),
        ).toHaveLength(1),
      { timeout: 5000, interval: 100 },
    );
    await new Promise((resolve) => setTimeout(resolve, 800));
    const announced = rcon.commands.filter((command) => command.startsWith('tellraw @a'));
    expect(announced).toHaveLength(1);
    expect(announced[0]).toContain('Type !top');

    // Counting on request saves the world first, and only running events can be counted.
    const flushes = rcon.commands.filter((command) => command === 'save-all flush').length;
    await writeStats(STEVE, { 'minecraft:oak_log': 12 });
    const counted = await send(server, 'POST', `${url}/events/${id}/count`, {
      cookie: owner.cookie,
    });
    expect(counted.statusCode).toBe(200);
    expect(counted.json<Detail>().standings.map(({ name, score }) => [name, score])).toEqual([
      ['Steve', 2],
    ]);
    expect(rcon.commands.filter((command) => command === 'save-all flush').length).toBe(
      flushes + 1,
    );
    expect(
      (await send(server, 'POST', `${url}/events/${id}/count`, { cookie: viewer.cookie }))
        .statusCode,
    ).toBe(403);
    await send(server, 'POST', `${url}/events/${id}/cancel`, { cookie: owner.cookie });
    expect(
      (await send(server, 'POST', `${url}/events/${id}/count`, { cookie: owner.cookie })).json(),
    ).toMatchObject({ error: { code: 'event_not_running' } });

    // The commands of a reward can be tried on a player.
    const tested = await send(server, 'POST', `${url}/rewards/test`, {
      cookie: owner.cookie,
      body: {
        player: 'Steve',
        eventName: 'Wood week',
        place: 1,
        commands: ['give {player} diamond 5'],
      },
    });
    expect(tested.json()).toEqual({
      results: [{ command: 'give Steve diamond 5', reply: '', ok: true }],
    });
    expect(rcon.commands).toContain('give Steve diamond 5');
    const denied = await send(server, 'POST', `${url}/rewards/test`, {
      cookie: viewer.cookie,
      body: { player: 'Steve', eventName: 'x', place: 1, commands: ['say hi'] },
    });
    expect(denied.statusCode).toBe(403);
    const badName = await send(server, 'POST', `${url}/rewards/test`, {
      cookie: owner.cookie,
      body: { player: 'Steve; op Steve', eventName: 'x', place: 1, commands: ['say hi'] },
    });
    expect(badName.statusCode).toBe(400);
  }, 30_000);

  it('list the players to pick from, with the operators marked', async () => {
    const { server, owner, viewer, url } = await setUp();
    const players = await get(server, `${url}/players`, owner.cookie);
    expect(players.json()).toEqual({
      players: [
        { uuid: ALEX, name: 'Alex', operator: false },
        { uuid: OPERATOR, name: 'Boss', operator: true },
        { uuid: NEWBIE, name: 'Newbie', operator: false },
        { uuid: STEVE, name: 'Steve', operator: false },
      ],
    });
    expect((await get(server, `${url}/players`, viewer.cookie)).statusCode).toBe(403);
  });
});
