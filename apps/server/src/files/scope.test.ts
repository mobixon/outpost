import type { FileEntry, FileScopes, PluginContext } from '@outpost/plugin-api';
import { describe, expect, it } from 'vitest';
import { scopedFiles } from './scope.js';

const entry = (name: string, type: FileEntry['type'] = 'file'): FileEntry => ({
  name,
  type,
  size: 0,
  modifiedAt: new Date(0),
});

/** Files that record what reaches them. */
function scoped(scopes: FileScopes | undefined, listings: Record<string, FileEntry[]> = {}) {
  const calls: string[] = [];
  const files: PluginContext['files'] = {
    read: (_serverId, path) => {
      calls.push(`read ${path}`);
      return Promise.resolve(new Uint8Array());
    },
    write: (_serverId, path) => {
      calls.push(`write ${path}`);
      return Promise.resolve();
    },
    stat: (_serverId, path) => {
      calls.push(`stat ${path}`);
      return Promise.resolve(null);
    },
    list: (_serverId, path) => {
      calls.push(`list ${path}`);
      return Promise.resolve(listings[path] ?? []);
    },
  };
  return { files: scopedFiles('test.module', scopes, files), calls };
}

const refused = { statusCode: 403, code: 'file_out_of_scope' };

describe('file scopes of modules', () => {
  it('refuse every file to a module without scopes', async () => {
    const { files, calls } = scoped(undefined);
    await expect(files.read('s', 'server.properties')).rejects.toMatchObject(refused);
    await expect(files.write('s', 'x.txt', 'x')).rejects.toMatchObject(refused);
    await expect(files.stat('s', '')).rejects.toMatchObject(refused);
    await expect(files.list('s', '')).rejects.toMatchObject(refused);
    expect(calls).toEqual([]);
  });

  it('allow reading the read paths and reading and writing the write paths', async () => {
    const { files, calls } = scoped({
      read: ['server.properties'],
      write: ['whitelist.json'],
    });
    await files.read('s', 'server.properties');
    await files.read('s', './whitelist.json');
    await files.write('s', 'whitelist.json', '[]');
    await expect(files.write('s', 'server.properties', '')).rejects.toMatchObject(refused);
    await expect(files.read('s', 'ops.json')).rejects.toMatchObject(refused);
    await expect(files.read('s', 'world/server.properties')).rejects.toMatchObject(refused);
    await expect(files.read('s', '../server.properties')).rejects.toMatchObject({
      statusCode: 400,
      code: 'invalid_path',
    });
    expect(calls).toEqual([
      'read server.properties',
      'read ./whitelist.json',
      'write whitelist.json',
    ]);
  });

  it('match * within a name and ** across folders', async () => {
    const { files } = scoped({ read: ['world/stats/*.json', 'logs/**'] });
    await files.read('s', 'world/stats/0000-1111.json');
    await files.read('s', 'logs/latest.log');
    await files.read('s', 'logs/2026/09/14-1.log.gz');
    await expect(files.read('s', 'world/stats/a.txt')).rejects.toMatchObject(refused);
    await expect(files.read('s', 'world/stats/old/a.json')).rejects.toMatchObject(refused);
    await expect(files.read('s', 'world/level.dat')).rejects.toMatchObject(refused);
  });

  it('let modules list and stat the folders on the way and show only their files', async () => {
    const { files } = scoped(
      { read: ['world/stats/*.json'] },
      {
        '': [
          entry('server.properties'),
          entry('world', 'directory'),
          entry('plugins', 'directory'),
        ],
        world: [entry('level.dat'), entry('stats', 'directory'), entry('region', 'directory')],
        'world/stats': [entry('a.json'), entry('b.txt'), entry('old', 'directory')],
      },
    );
    const names = async (path: string) => (await files.list('s', path)).map((item) => item.name);
    expect(await names('')).toEqual(['world']);
    expect(await names('world')).toEqual(['stats']);
    expect(await names('world/stats')).toEqual(['a.json']);
    await files.stat('s', 'world');
    await files.stat('s', 'world/stats/a.json');
    await expect(files.list('s', 'plugins')).rejects.toMatchObject(refused);
    await expect(files.stat('s', 'world/level.dat')).rejects.toMatchObject(refused);
  });
});
