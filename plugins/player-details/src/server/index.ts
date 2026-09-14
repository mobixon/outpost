import {
  definePlugin,
  HttpError,
  PLUGIN_API_VERSION,
  type PluginContext,
  type PluginDefinition,
} from '@outpost/plugin-api';
import { CorePermission } from '@outpost/shared';
import { z } from 'zod';
import {
  assetsSchema,
  downloadRequestSchema,
  nameLocaleSchema,
  PLAYER_DETAILS_PLUGIN_ID,
  PlayerDetailsPermission,
  playerDetailSchema,
  playerListSchema,
  type Icon,
  type Item,
  type PlayerDetail,
} from '../shared.js';
import { AssetStore } from './assets.js';
import { DataError, gunzip } from './data.js';
import { texturesOf } from './icons.js';
import { downloadAssets, type AssetSet } from './mojang.js';
import { Names } from './names.js';
import { readNbt } from './nbt.js';
import { readAdvancements, readPlayer, readStats } from './player.js';
import { migrations, type PlayerDetailsTables } from './tables.js';
import {
  findWorld,
  listPlayers,
  MAX_UNPACKED_BYTES,
  playerNames,
  readJson,
  worldVersion,
} from './world.js';

export interface PlayerDetailsPluginOptions {
  /** Used for the downloads from Mojang; tests pass a fake. */
  fetch?: typeof fetch;
}

/** The files the module reads: the level and the player files, in both layouts of the world. */
const FILES = [
  'server.properties',
  'usercache.json',
  '**/level.dat',
  '**/players/data/*.dat',
  '**/playerdata/*.dat',
  '**/stats/*.json',
  '**/advancements/*.json',
];

const capability = 'files.read';

export function createPlayerDetailsPlugin(
  options: PlayerDetailsPluginOptions = {},
): PluginDefinition {
  const fetchImpl = options.fetch ?? fetch;
  return definePlugin({
    id: PLAYER_DETAILS_PLUGIN_ID,
    version: '0.1.0',
    apiVersion: PLUGIN_API_VERSION,
    games: ['minecraft-java'],
    files: { read: FILES },
    migrations,
    permissions: [
      { key: PlayerDetailsPermission.view, roles: ['owner', 'admin', 'moderator'] },
      { key: PlayerDetailsPermission.location, roles: ['owner', 'admin'] },
    ],
    setup: (ctx) => setup(ctx, fetchImpl),
  });
}

export default createPlayerDetailsPlugin();

/** The icons of the items shown and the textures they use. */
function iconsFor(
  items: readonly Item[],
  assets: AssetSet | null,
): Pick<PlayerDetail, 'icons' | 'textures'> {
  const icons: Record<string, Icon> = {};
  const textures: Record<string, string> = {};
  if (assets === null) return { icons, textures };
  for (const item of items.flatMap((entry) => [entry, ...(entry.contents ?? [])])) {
    const icon = assets.icons[item.icon] ?? assets.icons[item.id];
    if (icon === undefined) continue;
    icons[item.icon] = icon;
    for (const texture of texturesOf(icon)) {
      const data = assets.textures[texture];
      if (data !== undefined) textures[texture] = data;
    }
  }
  return { icons, textures };
}

function setup(ctx: PluginContext, fetchImpl: typeof fetch): void {
  const aborts = new AbortController();
  const assets = new AssetStore(
    ctx.db<PlayerDetailsTables>(),
    (version) => downloadAssets(version, fetchImpl, aborts.signal),
    ctx.logger,
  );
  ctx.onShutdown(async () => {
    aborts.abort();
    await assets.idle();
  });

  async function worldOf(serverId: string) {
    const world = await findWorld(ctx.files, serverId);
    return { world, version: await worldVersion(ctx.files, serverId, world) };
  }

  ctx.http.serverRoute({
    method: 'GET',
    url: '/players',
    permission: PlayerDetailsPermission.view,
    capability,
    schema: { response: playerListSchema },
    handler: async ({ server }) => {
      const { world, version } = await worldOf(server.id);
      const [players, names] = await Promise.all([
        listPlayers(ctx.files, server.id, world),
        playerNames(ctx.files, server.id),
      ]);
      return {
        players: players
          .sort((a, b) => b.savedAt.getTime() - a.savedAt.getTime())
          .map((player) => ({
            uuid: player.uuid,
            name: names.get(player.uuid) ?? null,
            savedAt: player.savedAt.toISOString(),
          })),
        assets: await assets.state(version),
      };
    },
  });

  ctx.http.serverRoute({
    method: 'GET',
    url: '/players/:uuid',
    permission: PlayerDetailsPermission.view,
    capability,
    schema: {
      params: z.object({
        uuid: z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i),
      }),
      querystring: z.object({ locale: nameLocaleSchema.catch('en') }),
      response: playerDetailSchema,
    },
    handler: async ({ server, params, query, permissions }): Promise<PlayerDetail> => {
      const uuid = params.uuid.toLowerCase();
      const { world, version } = await worldOf(server.id);
      const path = `${world.data}/${uuid}.dat`;
      let file: Uint8Array;
      try {
        file = await ctx.files.read(server.id, path);
      } catch (err) {
        if (err instanceof HttpError && err.code === 'file_not_found') {
          throw new HttpError(404, 'player_not_found', 'The world has no file of this player');
        }
        throw err;
      }
      let data;
      try {
        data = readNbt(await gunzip(file, MAX_UNPACKED_BYTES));
      } catch (err) {
        if (!(err instanceof DataError)) throw err;
        throw new HttpError(
          422,
          'unreadable_player_file',
          `The player file cannot be read: ${err.message}`,
        );
      }

      const [set, names, saved, stats, advancements] = await Promise.all([
        assets.get(version),
        playerNames(ctx.files, server.id),
        ctx.files.stat(server.id, path),
        readJson(ctx.files, server.id, `${world.stats}/${uuid}.json`),
        readJson(ctx.files, server.id, `${world.advancements}/${uuid}.json`),
      ]);
      const translated = new Names(set?.names[query.locale] ?? {}, set?.names.en ?? {});
      const player = readPlayer(
        data,
        translated,
        permissions.has(PlayerDetailsPermission.location),
      );
      const worn = [player.armor.head, player.armor.chest, player.armor.legs, player.armor.feet];
      const items = [...player.inventory, ...player.enderChest, ...worn, player.offhand].filter(
        (item): item is Item => item !== null,
      );
      return {
        uuid,
        name: names.get(uuid) ?? null,
        savedAt: (saved?.modifiedAt ?? new Date()).toISOString(),
        ...player,
        stats: readStats(stats, translated),
        advancements: readAdvancements(advancements, translated),
        ...iconsFor(items, set),
        assets: await assets.state(version),
      };
    },
  });

  ctx.http.serverRoute({
    method: 'GET',
    url: '/assets',
    permission: PlayerDetailsPermission.view,
    capability,
    schema: { response: assetsSchema },
    handler: async ({ server }) => assets.state((await worldOf(server.id)).version),
  });

  // Owners download the icons: it accepts the Minecraft EULA for the instance.
  ctx.http.serverRoute({
    method: 'POST',
    url: '/assets',
    permission: CorePermission.manage,
    capability,
    schema: { body: downloadRequestSchema, response: assetsSchema },
    handler: async ({ server, user, ip }) => {
      const { version } = await worldOf(server.id);
      if (version === null) {
        throw new HttpError(
          409,
          'version_unknown',
          'The Minecraft version of the world cannot be read from level.dat',
        );
      }
      const current = await assets.state(version);
      if (current.state === 'ready' || current.state === 'downloading') return current;
      assets.start(version);
      await ctx.audit.record({
        action: 'assets_download',
        userId: user.id,
        serverId: server.id,
        ip,
        details: { version },
      });
      return assets.state(version);
    },
  });
}
