import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPlayerDetailsPlugin } from '@outpost/plugin-player-details/server';
import {
  byte,
  gzip,
  int,
  writeNbt,
  writeZip,
  type NbtInput,
} from '@outpost/plugin-player-details/testing';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUserWithInvitation, get, send, setUpAdmin, startTestApp } from '../test-helpers.js';

const STEVE = '5627dd98-e6be-3c21-b8a8-e92344183641';
const ALEX = '36532b5e-c442-3dbb-a24c-c7e55d0f979a';

const player = (item: string): { [name: string]: NbtInput } => ({
  DataVersion: int(4903),
  Inventory: [{ Slot: byte(0), id: item, count: int(1) }],
  Pos: [],
  playerGameType: int(0),
});

let root: string;
let world: string;
let app: FastifyInstance | undefined;

async function writeWorld(layout: 'players' | 'legacy'): Promise<void> {
  const folders =
    layout === 'players'
      ? { data: 'players/data', stats: 'players/stats', advancements: 'players/advancements' }
      : { data: 'playerdata', stats: 'stats', advancements: 'advancements' };
  for (const folder of Object.values(folders))
    await mkdir(path.join(world, folder), { recursive: true });
  await writeFile(
    path.join(world, 'level.dat'),
    await gzip(writeNbt({ Data: { Version: { Id: int(4903), Name: '26.2' } } })),
  );
  const steve = path.join(world, folders.data, `${STEVE}.dat`);
  await writeFile(steve, await gzip(writeNbt(player('minecraft:diamond_sword'))));
  await writeFile(path.join(world, folders.data, `${STEVE}.dat_old`), 'old');
  const alex = path.join(world, folders.data, `${ALEX}.dat`);
  await writeFile(alex, await gzip(writeNbt(player('minecraft:stick'))));
  await utimes(alex, new Date('2026-09-01T10:00:00Z'), new Date('2026-09-01T10:00:00Z'));
  await utimes(steve, new Date('2026-09-10T10:00:00Z'), new Date('2026-09-10T10:00:00Z'));
  await writeFile(
    path.join(world, folders.stats, `${STEVE}.json`),
    JSON.stringify({ stats: { 'minecraft:custom': { 'minecraft:deaths': 3 } }, DataVersion: 4903 }),
  );
  await writeFile(
    path.join(world, folders.advancements, `${STEVE}.json`),
    JSON.stringify({
      'minecraft:story/mine_stone': {
        criteria: { get_stone: '2026-09-06 13:59:20 +0000' },
        done: true,
      },
      DataVersion: 4903,
    }),
  );
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'outpost-player-details-'));
  world = path.join(root, 'survival', 'world');
  await mkdir(world, { recursive: true });
  await writeFile(path.join(root, 'survival', 'server.properties'), 'level-name=world\n');
  await writeFile(
    path.join(root, 'survival', 'usercache.json'),
    JSON.stringify([{ name: 'Steve', uuid: STEVE, expiresOn: '2026-10-10 10:00:00 +0000' }]),
  );
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  await rm(root, { recursive: true, force: true });
});

const sha1 = (data: string | Uint8Array) => createHash('sha1').update(data).digest('hex');

/** Mojang's servers, as far as the download of the icons goes. */
async function mojang(versions: string[] = ['26.2']) {
  const jar = await writeZip({
    'assets/minecraft/items/diamond_sword.json': JSON.stringify({
      model: { type: 'minecraft:model', model: 'minecraft:item/diamond_sword' },
    }),
    'assets/minecraft/models/item/diamond_sword.json': JSON.stringify({
      parent: 'minecraft:item/generated',
      textures: { layer0: 'minecraft:item/diamond_sword' },
    }),
    'assets/minecraft/models/item/generated.json': JSON.stringify({ parent: 'builtin/generated' }),
    'assets/minecraft/textures/item/diamond_sword.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    'assets/minecraft/lang/en_us.json': JSON.stringify({
      'item.minecraft.diamond_sword': 'Diamond Sword',
      'menu.quit': 'Quit Game',
    }),
  });
  const russian = JSON.stringify({ 'item.minecraft.diamond_sword': 'Алмазный меч' });
  const index = JSON.stringify({
    objects: { 'minecraft/lang/ru_ru.json': { hash: sha1(russian), size: russian.length } },
  });
  const version = JSON.stringify({
    assetIndex: { url: 'https://piston-meta.test/indexes/32.json', sha1: sha1(index) },
    downloads: { client: { url: 'https://piston-data.test/client.jar', sha1: sha1(jar) } },
  });
  const manifest = JSON.stringify({
    versions: versions.map((id) => ({
      id,
      url: `https://piston-meta.test/${id}.json`,
      sha1: sha1(version),
    })),
  });
  const files = new Map<string, string | Uint8Array<ArrayBuffer>>([
    ['https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', manifest],
    ['https://piston-meta.test/26.2.json', version],
    ['https://piston-data.test/client.jar', jar],
    ['https://piston-meta.test/indexes/32.json', index],
    [
      `https://resources.download.minecraft.net/${sha1(russian).slice(0, 2)}/${sha1(russian)}`,
      russian,
    ],
  ]);
  const requests: string[] = [];
  const fetchImpl = ((input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push(url);
    const body = files.get(url);
    return Promise.resolve(
      body === undefined ? new Response('Not found', { status: 404 }) : new Response(body),
    );
  }) as typeof fetch;
  return { fetch: fetchImpl, requests };
}

async function setUp(fetchImpl?: typeof fetch) {
  app = await startTestApp({
    env: { OUTPOST_REQUIRE_2FA_FOR_ADMINS: 'false', OUTPOST_FILES_ROOT: root },
    plugins: [createPlayerDetailsPlugin(fetchImpl ? { fetch: fetchImpl } : {})],
  });
  const outpost = app;
  const admin = await setUpAdmin(outpost);
  const created = await send(outpost, 'POST', '/api/v1/servers', {
    cookie: admin,
    body: { name: 'Survival', slug: 'survival', game: 'minecraft-java' },
  });
  const serverId = created.json<{ id: string }>().id;
  const saved = await send(outpost, 'PUT', `/api/v1/servers/${serverId}/files`, {
    cookie: admin,
    body: { source: 'folder', path: 'survival', writable: false },
  });
  expect(saved.statusCode).toBe(204);
  const member = (username: string, role: string) =>
    createUserWithInvitation(outpost, admin, username, { serverId, role });
  const [owner, moderator, viewer] = await Promise.all([
    member('the-owner', 'owner'),
    member('the-moderator', 'moderator'),
    member('the-viewer', 'viewer'),
  ]);
  const base = `/api/v1/servers/${serverId}/plugins/outpost.player-details`;
  const fetchJson = (url: string, cookie: string) =>
    get(outpost, `${base}${url}`, cookie).then((response) => response.json());
  return { outpost, admin, serverId, owner, moderator, viewer, base, fetchJson };
}

async function readyAssets(
  fetchJson: (url: string, cookie: string) => Promise<unknown>,
  cookie: string,
) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const state = (await fetchJson('/assets', cookie)) as { state: string };
    if (state.state !== 'downloading') return state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('The download does not end');
}

describe('player details', () => {
  it('list the players of the world and show their inventory, statistics and advancements', async () => {
    await writeWorld('players');
    const { outpost, owner, moderator, viewer, base, fetchJson } = await setUp();

    expect(await fetchJson('/players', moderator.cookie)).toEqual({
      players: [
        { uuid: STEVE, name: 'Steve', savedAt: '2026-09-10T10:00:00.000Z' },
        { uuid: ALEX, name: null, savedAt: '2026-09-01T10:00:00.000Z' },
      ],
      assets: { version: '26.2', state: 'missing', error: null },
    });
    expect((await get(outpost, `${base}/players`, viewer.cookie)).statusCode).toBe(403);

    const detail = await fetchJson(`/players/${STEVE.toUpperCase()}`, moderator.cookie);
    expect(detail).toMatchObject({
      uuid: STEVE,
      name: 'Steve',
      gameMode: 'survival',
      inventory: [
        { slot: 0, id: 'minecraft:diamond_sword', label: 'Diamond Sword', maxDamage: 1561 },
      ],
      // Moderators do not see where players are.
      location: null,
      stats: { custom: [{ key: 'deaths', value: 3 }] },
      advancements: [{ id: 'minecraft:story/mine_stone', doneAt: '2026-09-06T13:59:20.000Z' }],
      icons: {},
      textures: {},
    });
    expect(await fetchJson(`/players/${STEVE}`, owner.cookie)).toMatchObject({
      location: { position: null, respawn: null, lastDeath: null },
    });
    expect(await fetchJson(`/players/${ALEX}`, owner.cookie)).toMatchObject({
      name: null,
      stats: null,
      advancements: null,
    });
    expect(
      await fetchJson('/players/00000000-0000-3000-8000-000000000000', owner.cookie),
    ).toMatchObject({
      error: { code: 'player_not_found' },
    });
    expect((await get(outpost, `${base}/players/..%2Fops`, owner.cookie)).statusCode).toBe(400);
  });

  it('read the files of worlds from before 26.x', async () => {
    await writeWorld('legacy');
    const { owner, fetchJson } = await setUp();
    expect(await fetchJson('/players', owner.cookie)).toMatchObject({
      players: [{ uuid: STEVE }, { uuid: ALEX }],
    });
    expect(await fetchJson(`/players/${STEVE}`, owner.cookie)).toMatchObject({
      inventory: [{ id: 'minecraft:diamond_sword' }],
      stats: { custom: [{ key: 'deaths' }] },
    });
  });

  it('download the icons and names from Mojang once an owner accepts the EULA', async () => {
    await writeWorld('players');
    const server = await mojang();
    const { outpost, admin, serverId, owner, moderator, base, fetchJson } = await setUp(
      server.fetch,
    );

    const download = (body: object, cookie: string) =>
      send(outpost, 'POST', `${base}/assets`, { cookie, body });
    expect((await download({ acceptEula: true }, moderator.cookie)).statusCode).toBe(403);
    expect((await download({}, owner.cookie)).statusCode).toBe(400);
    expect(server.requests).toEqual([]);

    expect((await download({ acceptEula: true }, owner.cookie)).json()).toMatchObject({
      version: '26.2',
    });
    expect(await readyAssets(fetchJson, moderator.cookie)).toEqual({
      version: '26.2',
      state: 'ready',
      error: null,
    });

    expect(await fetchJson(`/players/${STEVE}?locale=ru`, moderator.cookie)).toMatchObject({
      inventory: [{ label: 'Алмазный меч', icon: 'minecraft:diamond_sword' }],
      icons: {
        'minecraft:diamond_sword': {
          kind: 'flat',
          layers: [{ texture: 'item/diamond_sword', tint: null }],
        },
      },
      textures: { 'item/diamond_sword': 'data:image/png;base64,iVBORw==' },
    });
    // Alex's stick has no icon in this client.
    expect(await fetchJson(`/players/${ALEX}`, moderator.cookie)).toMatchObject({
      inventory: [{ label: 'Stick' }],
      icons: {},
    });

    const audit = await get(
      outpost,
      `/api/v1/audit?serverId=${serverId}&action=outpost.player-details.assets_download`,
      admin,
    );
    expect(audit.json()).toMatchObject({ entries: [{ details: { version: '26.2' } }] });
  });

  it('report downloads that fail', async () => {
    await writeWorld('players');
    const server = await mojang(['26.1']);
    const { outpost, owner, base, fetchJson } = await setUp(server.fetch);
    await send(outpost, 'POST', `${base}/assets`, {
      cookie: owner.cookie,
      body: { acceptEula: true },
    });
    expect(await readyAssets(fetchJson, owner.cookie)).toEqual({
      version: '26.2',
      state: 'failed',
      error: 'version_unknown',
    });
  });
});
