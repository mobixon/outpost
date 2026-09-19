import { HttpError, type FileEntry, type FileStat } from '@outpost/plugin-api';
import { describe, expect, it } from 'vitest';
import type { ServerFiles } from '../files/access.js';
import { createStatistics } from './service.js';

const STEVE = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
const encoder = new TextEncoder();

/** The files of a server as a map; a name ending in `/` is a folder. */
function fakeFiles(files: Record<string, string>): ServerFiles {
  const notFound = () => new HttpError(404, 'file_not_found', 'No such file or directory');
  const when = new Date('2026-09-19T10:00:00Z');
  return {
    read: async (path) => {
      const content = files[path];
      if (content === undefined) throw notFound();
      return encoder.encode(content);
    },
    write: async () => undefined,
    readRange: async () => new Uint8Array(),
    stat: async (path): Promise<FileStat | null> =>
      path in files
        ? { type: 'file', size: 1, modifiedAt: when }
        : Object.keys(files).some((name) => name.startsWith(`${path}/`))
          ? { type: 'directory', size: 0, modifiedAt: when }
          : null,
    list: async (path): Promise<FileEntry[]> => {
      const names = Object.keys(files)
        .filter((name) => name.startsWith(`${path}/`))
        .map((name) => name.slice(path.length + 1))
        .filter((name) => !name.includes('/'));
      if (names.length === 0) throw notFound();
      return names.map((name) => ({ name, type: 'file', size: 1, modifiedAt: when }));
    },
  };
}

function setUp(files: Record<string, string>, commands = true) {
  const sent: string[] = [];
  const stats = createStatistics(
    (_serverId, action) => action(fakeFiles(files)),
    async (_serverId, command) => {
      sent.push(command);
      return '';
    },
    async () => commands,
  );
  return { stats, sent };
}

const statsFile = JSON.stringify({ stats: { 'minecraft:mined': { 'minecraft:oak_log': 3 } } });

describe('statistics', () => {
  it('read the folder of recent versions (26.x)', async () => {
    const { stats } = setUp({
      'server.properties': 'level-name=survival\n',
      [`survival/players/stats/${STEVE}.json`]: statsFile,
      'survival/players/stats/notes.txt': 'x',
    });
    expect(await stats.list('s1')).toEqual([
      { uuid: STEVE, modifiedAt: new Date('2026-09-19T10:00:00Z') },
    ]);
    expect(await stats.read('s1', STEVE)).toEqual({ mined: { 'minecraft:oak_log': 3 } });
    expect(await stats.read('s1', STEVE.toUpperCase())).not.toBeNull();
  });

  it('read the folder of older versions, and world when there is no server.properties', async () => {
    const { stats } = setUp({ [`world/stats/${STEVE}.json`]: statsFile });
    expect((await stats.list('s1')).map(({ uuid }) => uuid)).toEqual([STEVE]);
    expect(await stats.read('s1', STEVE)).not.toBeNull();
  });

  it('have nothing for players without a file, a broken file or a bad UUID', async () => {
    const { stats } = setUp({
      [`world/stats/${STEVE}.json`]: '{"stats": {"minecraft:mined"',
    });
    expect(await stats.read('s1', STEVE)).toBeNull();
    expect(await stats.read('s1', 'b1d1a2c3-0000-4000-8000-000000000003')).toBeNull();
    expect(await stats.read('s1', '../../server.properties')).toBeNull();
    expect(await setUp({}).stats.list('s1')).toEqual([]);
  });

  it('are flushed with save-all only when commands can be sent', async () => {
    const withCommands = setUp({});
    await withCommands.stats.flush('s1');
    expect(withCommands.sent).toEqual(['save-all flush']);
    const without = setUp({}, false);
    await without.stats.flush('s1');
    expect(without.sent).toEqual([]);
  });
});
