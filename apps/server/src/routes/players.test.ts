import { createPlayersPlugin } from '@outpost/plugin-players/server';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startFakeRconServer, type FakeRconServer } from '../connections/test-rcon-server.js';
import { createUserWithInvitation, get, send, setUpAdmin, startTestApp } from '../test-helpers.js';

// Name-based (offline mode) and Mojang (online mode) UUIDs.
const STEVE = { name: 'Steve', uuid: 'b50ad385-829d-3141-a216-7e7d7539ba7f' };
const ALEX = { name: 'Alex', uuid: '8667ba71-b85a-4004-af54-457a9734eed7' };
const GRIEFER = { name: 'Griefer', uuid: '11111111-2222-3333-8444-555555555555' };

/** A Minecraft server as far as its player commands go, answering like Minecraft 26.2. */
function minecraft() {
  const state = {
    online: [] as { name: string; uuid: string }[],
    whitelist: [] as string[],
    bans: [] as { name: string; reason: string }[],
    ipBans: [] as { ip: string; reason: string }[],
    ops: [] as string[],
  };
  const reply = (command: string): string => {
    const [verb = '', first = '', ...rest] = command.split(' ');
    const reason = [first, ...rest].slice(1).join(' ');
    switch (verb) {
      case 'list':
        return `There are ${state.online.length} of a max of 20 players online: ${state.online
          .map((player) => `${player.name} (${player.uuid})`)
          .join(', ')}`;
      case 'whitelist':
        if (first === 'list') {
          return state.whitelist.length === 0
            ? 'There are no whitelisted players'
            : `There are ${state.whitelist.length} whitelisted player(s): ${state.whitelist.join(', ')}`;
        }
        if (first === 'add') {
          state.whitelist.push(rest[0] ?? '');
          return `Added ${rest[0]} to the whitelist`;
        }
        if (first === 'remove') {
          state.whitelist = state.whitelist.filter((name) => name !== rest[0]);
          return `Removed ${rest[0]} from the whitelist`;
        }
        return `Whitelist is now turned ${first}`;
      case 'banlist': {
        const entries =
          first === 'ips'
            ? state.ipBans.map((ban) => `${ban.ip} was banned by Rcon: ${ban.reason}`)
            : state.bans.map((ban) => `${ban.name} was banned by Rcon: ${ban.reason}`);
        return entries.length === 0
          ? 'There are no bans'
          : `There are ${entries.length} ban(s):${entries.join('')}`;
      }
      case 'ban':
        state.bans.push({ name: first, reason: reason || 'Banned by an operator.' });
        return `Banned ${first}: ${reason || 'Banned by an operator.'}`;
      case 'pardon':
        state.bans = state.bans.filter((ban) => ban.name !== first);
        return `Unbanned ${first}`;
      case 'ban-ip':
        state.ipBans.push({ ip: first, reason: reason || 'Banned by an operator.' });
        return `Banned IP ${first}: ${reason}`;
      case 'kick':
        if (!state.online.some((player) => player.name === first)) return 'No player was found';
        state.online = state.online.filter((player) => player.name !== first);
        return `Kicked ${first}: ${reason || 'Kicked by an operator'}`;
      case 'op':
        state.ops.push(first);
        return `Made ${first} a server operator`;
      case 'deop':
        state.ops = state.ops.filter((name) => name !== first);
        return `Made ${first} no longer a server operator`;
      default:
        return '';
    }
  };
  return { state, reply };
}

let server: ReturnType<typeof minecraft>;
let rcon: FakeRconServer;
let app: FastifyInstance | undefined;

beforeEach(async () => {
  server = minecraft();
  rcon = await startFakeRconServer({
    password: 'secret',
    reply: (command) => server.reply(command),
  });
});

afterEach(async () => {
  vi.useRealTimers();
  await app?.close();
  app = undefined;
  await rcon.close();
});

async function setUp() {
  app = await startTestApp({
    env: { OUTPOST_REQUIRE_2FA_FOR_ADMINS: 'false' },
    plugins: [createPlayersPlugin({ pollIntervalMs: 0 })],
  });
  const outpost = app;
  const admin = await setUpAdmin(outpost);
  const created = await send(outpost, 'POST', '/api/v1/servers', {
    cookie: admin,
    body: { name: 'Survival', slug: 'survival', game: 'minecraft-java' },
  });
  const serverId = created.json<{ id: string }>().id;
  await send(outpost, 'PUT', `/api/v1/servers/${serverId}/connection`, {
    cookie: admin,
    body: {
      type: 'rcon',
      host: '127.0.0.1',
      port: rcon.port,
      password: 'secret',
    },
  });
  const member = (username: string, role: string) =>
    createUserWithInvitation(outpost, admin, username, { serverId, role });
  const [moderator, viewer] = await Promise.all([
    member('the-moderator', 'moderator'),
    member('the-viewer', 'viewer'),
  ]);
  const base = `/api/v1/servers/${serverId}/plugins/outpost.players`;
  const overview = (cookie = admin) =>
    get(outpost, `${base}/overview`, cookie).then((response) => response.json());
  const act = (path: string, body: object, cookie = admin) =>
    send(outpost, 'POST', `${base}${path}`, { cookie, body });
  return { outpost, admin, serverId, moderator, viewer, base, overview, act };
}

describe('players', () => {
  it('records joins, leaves and playtime and detects offline mode', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { outpost, admin, base, overview } = await setUp();
    const start = Date.now();

    server.state.online = [STEVE];
    expect(await overview()).toMatchObject({
      reachable: true,
      max: 20,
      mode: { effective: 'offline', detected: 'offline', override: null },
      online: [{ name: 'Steve', uuid: STEVE.uuid, since: new Date(start).toISOString() }],
    });
    vi.setSystemTime(start + 60_000);
    await overview();
    vi.setSystemTime(start + 90_000);
    server.state.online = [];
    expect(await overview()).toMatchObject({ online: [] });

    const page = (await get(outpost, `${base}/players?search=ste`, admin)).json();
    expect(page).toMatchObject({
      total: 1,
      players: [{ name: 'Steve', playtimeMs: 60_000, online: false }],
    });
    expect((await get(outpost, `${base}/players/${STEVE.uuid}`, admin)).json()).toMatchObject({
      player: { name: 'Steve', firstSeen: new Date(start).toISOString() },
      sessions: [
        { joinedAt: new Date(start).toISOString(), leftAt: new Date(start + 60_000).toISOString() },
      ],
    });
  });

  it('let bans and operator rights for unseen players wait on offline servers', async () => {
    const { outpost, admin, serverId, moderator, base, overview, act } = await setUp();
    server.state.online = [STEVE];
    await overview();

    const ban = await act('/ban', { name: 'Griefer', reason: 'griefing the spawn' });
    expect(ban.json()).toEqual({ reply: '', pending: true, warning: null });
    expect(server.state.bans).toEqual([]);
    const op = (await act('/op', { name: 'Newbie' })).json<{ pending: boolean }>();
    expect(op.pending).toBe(true);
    const { pending } = await overview();
    expect(pending).toMatchObject([
      {
        name: 'Griefer',
        action: 'ban',
        reason: 'griefing the spawn.',
        createdBy: expect.any(String),
      },
      { name: 'Newbie', action: 'op' },
    ]);

    // Seen players are banned at once.
    expect((await act('/ban', { name: 'Steve' })).json()).toEqual({
      reply: 'Banned Steve: Banned by an operator.',
      pending: false,
      warning: null,
    });

    // The pending ban applies when Griefer shows up.
    server.state.online = [STEVE, GRIEFER];
    expect((await overview()).pending).toMatchObject([{ name: 'Newbie' }]);
    expect(server.state.bans).toContainEqual({ name: 'Griefer', reason: 'griefing the spawn.' });

    // A moderator may cancel pending bans but not operator rights; admins apply them at once.
    const newbie = pending.find((entry: { name: string }) => entry.name === 'Newbie');
    const cancel = await send(outpost, 'DELETE', `${base}/pending/${newbie.id}`, {
      cookie: moderator.cookie,
    });
    expect(cancel.statusCode).toBe(403);
    const applied = await send(outpost, 'POST', `${base}/pending/${newbie.id}/apply`, {
      cookie: admin,
    });
    expect(applied.json()).toMatchObject({ reply: 'Made Newbie a server operator' });
    expect((await overview()).pending).toEqual([]);

    const audit = await get(
      outpost,
      `/api/v1/audit?serverId=${serverId}&action=outpost.players.pending`,
      admin,
    );
    // Entries of the same millisecond have no fixed order.
    expect(
      audit
        .json<{ entries: { action: string }[] }>()
        .entries.map((entry) => entry.action)
        .sort(),
    ).toEqual(
      [
        'outpost.players.pending_forced',
        'outpost.players.pending_applied',
        'outpost.players.pending_applied',
        'outpost.players.pending_created',
        'outpost.players.pending_created',
      ].sort(),
    );
  });

  it('warn when whitelisting unseen players on offline servers', async () => {
    const { outpost, admin, base, overview, act } = await setUp();
    server.state.online = [STEVE];
    await overview();

    expect((await act('/whitelist/add', { name: 'Newbie' })).json()).toEqual({
      reply: 'Added Newbie to the whitelist',
      pending: false,
      warning: 'offline_unknown_player',
    });
    expect((await act('/whitelist/add', { name: 'Steve' })).json()).toMatchObject({
      warning: null,
    });

    // An online-mode server set by hand: no warnings, no waiting.
    await send(outpost, 'PUT', `${base}/mode`, { cookie: admin, body: { mode: 'online' } });
    expect((await overview()).mode).toEqual({
      effective: 'online',
      detected: 'offline',
      override: 'online',
    });
    expect((await act('/whitelist/add', { name: 'Other' })).json()).toMatchObject({
      warning: null,
    });
    expect((await act('/ban', { name: 'Nobody' })).json()).toMatchObject({ pending: false });

    expect((await overview()).whitelist).toEqual(['Newbie', 'Steve', 'Other']);
    expect((await act('/whitelist/remove', { name: 'Other' })).json()).toMatchObject({
      reply: 'Removed Other from the whitelist',
    });
    expect((await act('/whitelist/state', { enabled: true })).json()).toMatchObject({
      reply: 'Whitelist is now turned on',
    });
  });

  it('list bans, including IP bans, and tell reasons from names', async () => {
    const { overview, act } = await setUp();
    server.state.online = [ALEX];
    await overview();
    server.state.bans = [
      { name: 'Notch', reason: 'griefing the spawn' },
      { name: 'Alex', reason: 'x' },
    ];
    expect((await act('/ban-ip', { ip: '10.1.2.3', reason: 'spam' })).json()).toMatchObject({
      reply: 'Banned IP 10.1.2.3: spam.',
    });
    const { bans, ipBans, mode } = await overview();
    expect(mode.effective).toBe('online');
    expect(bans).toEqual([
      { target: 'Notch', source: 'Rcon', reason: 'griefing the spawn' },
      { target: 'Alex', source: 'Rcon', reason: 'x' },
    ]);
    expect(ipBans).toEqual([{ target: '10.1.2.3', source: 'Rcon', reason: 'spam.' }]);
  });

  it('check permissions and player names', async () => {
    const { moderator, viewer, overview, act } = await setUp();
    server.state.online = [ALEX];
    expect((await overview(viewer.cookie)).online).toHaveLength(1);
    expect((await act('/kick', { name: 'Alex' }, viewer.cookie)).statusCode).toBe(403);
    expect(
      (await act('/kick', { name: 'Alex', reason: 'afk' }, moderator.cookie)).json(),
    ).toMatchObject({
      reply: 'Kicked Alex: afk.',
    });
    expect((await act('/op', { name: 'Alex' }, moderator.cookie)).statusCode).toBe(403);
    expect((await act('/ban', { name: 'bad name; op me' })).statusCode).toBe(400);
    expect((await act('/ban-ip', { ip: 'not-an-ip' })).statusCode).toBe(400);
  });

  it('report an unreachable server but keep the pending actions', async () => {
    const { overview, act } = await setUp();
    server.state.online = [STEVE];
    await overview();
    await act('/ban', { name: 'Griefer' });
    await rcon.close();
    expect(await overview()).toMatchObject({
      reachable: false,
      error: 'connection_closed',
      online: [],
      whitelist: null,
      pending: [{ name: 'Griefer' }],
    });
  });
});
