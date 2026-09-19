import { HttpError, type PlayerStatistics, type StatsFile } from '@outpost/plugin-api';
import { normalizeUuid, parseProperties, parseStats } from '@outpost/shared';
import type { ServerFiles } from '../files/access.js';

const decoder = new TextDecoder();
/** How long the folder of the statistics of a server is remembered. */
const FOLDER_TTL_MS = 60_000;

/** Runs `action` with the files of a server; see `FileAccess.run`. */
export type RunWithFiles = <T>(
  serverId: string,
  action: (files: ServerFiles) => Promise<T>,
) => Promise<T>;

/**
 * The statistics of the players from the world of a Minecraft server: `<world>/players/stats`
 * since version 26.x, `<world>/stats` before. The world is the `level-name` of `server.properties`.
 */
export function createStatistics(
  run: RunWithFiles,
  send: (serverId: string, command: string) => Promise<string>,
  hasCommands: (serverId: string) => Promise<boolean>,
): PlayerStatistics {
  const folders = new Map<string, { folder: string; until: number }>();

  async function folderOf(serverId: string, files: ServerFiles): Promise<string> {
    const known = folders.get(serverId);
    if (known !== undefined && known.until > Date.now()) return known.folder;
    let world = 'world';
    try {
      const properties = parseProperties(decoder.decode(await files.read('server.properties')));
      world = properties.get('level-name')?.trim() || world;
    } catch (err) {
      if (!(err instanceof HttpError) || err.statusCode !== 404) throw err;
    }
    const recent = await files.stat(`${world}/players/stats`);
    const folder = recent?.type === 'directory' ? `${world}/players/stats` : `${world}/stats`;
    folders.set(serverId, { folder, until: Date.now() + FOLDER_TTL_MS });
    return folder;
  }

  return {
    list: (serverId) =>
      run(serverId, async (files) => {
        const entries = await files.list(await folderOf(serverId, files)).catch((err: unknown) => {
          if (err instanceof HttpError && err.statusCode === 404) return [];
          throw err;
        });
        const found: StatsFile[] = [];
        for (const entry of entries) {
          if (entry.type !== 'file' || !entry.name.endsWith('.json')) continue;
          const uuid = normalizeUuid(entry.name.slice(0, -'.json'.length));
          if (uuid !== null) found.push({ uuid, modifiedAt: entry.modifiedAt });
        }
        return found;
      }),

    read: (serverId, uuid) => {
      const normalized = normalizeUuid(uuid);
      if (normalized === null) return Promise.resolve(null);
      return run(serverId, async (files) => {
        try {
          const bytes = await files.read(`${await folderOf(serverId, files)}/${normalized}.json`);
          return parseStats(JSON.parse(decoder.decode(bytes)));
        } catch (err) {
          if (err instanceof HttpError && err.statusCode === 404) return null;
          // A file that is being written can be cut off.
          if (err instanceof SyntaxError) return null;
          throw err;
        }
      });
    },

    flush: async (serverId) => {
      if (await hasCommands(serverId)) await send(serverId, 'save-all flush');
    },
  };
}
