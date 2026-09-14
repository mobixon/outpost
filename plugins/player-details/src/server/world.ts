import { HttpError, type PluginContext } from '@outpost/plugin-api';
import { parseProperties } from '@outpost/shared';
import { z } from 'zod';
import { gunzip } from './data.js';
import { isCompound, readNbt } from './nbt.js';

type Files = PluginContext['files'];

/** Where the world keeps the files of its players. */
export interface WorldFiles {
  /** The folder of the world (`level-name`). */
  folder: string;
  data: string;
  stats: string;
  advancements: string;
}

/** Player and level files are small; more than this unpacked is damaged or hostile data. */
export const MAX_UNPACKED_BYTES = 16 * 1024 * 1024;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PLAYER_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.dat$/;

const decoder = new TextDecoder();

/** The text of a file; null when it does not exist. */
export async function readText(
  files: Files,
  serverId: string,
  path: string,
): Promise<string | null> {
  try {
    return decoder.decode(await files.read(serverId, path));
  } catch (err) {
    if (err instanceof HttpError && err.code === 'file_not_found') return null;
    throw err;
  }
}

/** A JSON file; null when it does not exist or is not JSON. */
export async function readJson(files: Files, serverId: string, path: string): Promise<unknown> {
  const text = await readText(files, serverId, path);
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * The world of the server. Recent versions (26.x) keep the player files in `<world>/players/data`,
 * `stats` and `advancements`; older versions in `playerdata`, `stats` and `advancements` of the
 * world.
 */
export async function findWorld(files: Files, serverId: string): Promise<WorldFiles> {
  const properties = await readText(files, serverId, 'server.properties');
  const folder =
    (properties === null ? undefined : parseProperties(properties).get('level-name'))?.trim() ||
    'world';
  const players = await files.stat(serverId, `${folder}/players/data`);
  return players?.type === 'directory'
    ? {
        folder,
        data: `${folder}/players/data`,
        stats: `${folder}/players/stats`,
        advancements: `${folder}/players/advancements`,
      }
    : {
        folder,
        data: `${folder}/playerdata`,
        stats: `${folder}/stats`,
        advancements: `${folder}/advancements`,
      };
}

/** The Minecraft version of the world, from level.dat; null when it cannot be read. */
export async function worldVersion(
  files: Files,
  serverId: string,
  world: WorldFiles,
): Promise<string | null> {
  try {
    const level = readNbt(
      await gunzip(await files.read(serverId, `${world.folder}/level.dat`), MAX_UNPACKED_BYTES),
    );
    const version = isCompound(level.Data) ? level.Data.Version : undefined;
    const name = isCompound(version) ? version.Name : undefined;
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

const userCacheSchema = z.array(z.object({ name: z.string(), uuid: z.string() }));

/** Names of the players the server has seen, by UUID (`usercache.json`). */
export async function playerNames(files: Files, serverId: string): Promise<Map<string, string>> {
  const cache = userCacheSchema.safeParse(await readJson(files, serverId, 'usercache.json'));
  return new Map(
    cache.success ? cache.data.map((entry) => [entry.uuid.toLowerCase(), entry.name]) : [],
  );
}

/** The players with a file in the world, with the time the server last saved each. */
export async function listPlayers(
  files: Files,
  serverId: string,
  world: WorldFiles,
): Promise<{ uuid: string; savedAt: Date }[]> {
  let entries;
  try {
    entries = await files.list(serverId, world.data);
  } catch (err) {
    if (err instanceof HttpError && err.code === 'file_not_found') return [];
    throw err;
  }
  return entries.flatMap((entry) => {
    const uuid =
      entry.type === 'file' ? PLAYER_FILE.exec(entry.name.toLowerCase())?.[1] : undefined;
    return uuid === undefined ? [] : [{ uuid, savedAt: entry.modifiedAt }];
  });
}
