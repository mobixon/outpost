import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderFiles, MAX_FILE_BYTES, pathSegments, testFolder } from './folder.js';

let root: string;
let outside: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'outpost-files-'));
  outside = await mkdtemp(path.join(tmpdir(), 'outpost-outside-'));
  await mkdir(path.join(root, 'survival', 'world'), { recursive: true });
  await writeFile(
    path.join(root, 'survival', 'server.properties'),
    '#Minecraft server properties\nlevel-name=world\nmotd=Hello\nonline-mode=false\n',
  );
  await writeFile(path.join(outside, 'secret.txt'), 'secret');
});

afterEach(async () => {
  await chmod(path.join(root, 'survival'), 0o755).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

const files = () => new FolderFiles(root, 'survival');
const isRoot = process.getuid?.() === 0;

describe('pathSegments', () => {
  it.each(['/etc/passwd', '../other', 'world/../../escape', 'a\\b', 'a\0b'])('rejects %j', (p) => {
    expect(() => pathSegments(p)).toThrow(/inside the folder/);
  });

  it('drops empty and . segments', () => {
    expect(pathSegments('world//stats/./a.json')).toEqual(['world', 'stats', 'a.json']);
    expect(pathSegments('')).toEqual([]);
  });
});

describe('FolderFiles', () => {
  it('reads, stats and lists files', async () => {
    expect(Buffer.from(await files().read('server.properties')).toString()).toContain(
      'level-name=world',
    );
    expect(await files().stat('world')).toMatchObject({ type: 'directory', size: 0 });
    expect(await files().stat('server.properties')).toMatchObject({ type: 'file' });
    expect(await files().stat('missing.json')).toBeNull();
    expect((await files().list('')).map(({ name, type }) => ({ name, type }))).toEqual([
      { name: 'server.properties', type: 'file' },
      { name: 'world', type: 'directory' },
    ]);
  });

  it('replaces files atomically and keeps their mode', async () => {
    await files().write('whitelist.json', '[]');
    const target = path.join(root, 'survival', 'whitelist.json');
    expect(await readFile(target, 'utf8')).toBe('[]');
    await chmod(target, 0o600);
    await files().write('whitelist.json', new TextEncoder().encode('[{"name":"Alex"}]'));
    expect(await readFile(target, 'utf8')).toBe('[{"name":"Alex"}]');
    expect((await stat(target)).mode & 0o777).toBe(0o600);
    // No temporary files are left behind.
    expect(await readdir(path.join(root, 'survival'))).toEqual([
      'server.properties',
      'whitelist.json',
      'world',
    ]);
  });

  it('refuses what is not a file, missing directories and large files', async () => {
    await expect(files().read('world')).rejects.toMatchObject({ code: 'not_a_file' });
    await expect(files().write('world', 'x')).rejects.toMatchObject({ code: 'not_a_file' });
    await expect(files().read('missing.json')).rejects.toMatchObject({
      statusCode: 404,
      code: 'file_not_found',
    });
    await expect(files().write('no/such/dir.json', 'x')).rejects.toMatchObject({
      code: 'file_not_found',
    });
    await expect(
      files().write('big.bin', new Uint8Array(MAX_FILE_BYTES + 1)),
    ).rejects.toMatchObject({ statusCode: 413, code: 'file_too_large' });
    await expect(files().list('server.properties')).rejects.toMatchObject({
      code: 'not_a_directory',
    });
  });

  it('follows symbolic links only while they stay inside the folder', async () => {
    await symlink(outside, path.join(root, 'survival', 'escape'));
    await symlink(path.join(root, 'survival', 'world'), path.join(root, 'survival', 'level'));
    await expect(files().read('escape/secret.txt')).rejects.toMatchObject({
      code: 'path_outside_folder',
    });
    await expect(files().write('escape/new.txt', 'x')).rejects.toMatchObject({
      code: 'path_outside_folder',
    });
    await expect(files().stat('escape')).rejects.toMatchObject({ code: 'path_outside_folder' });

    await files().write('level/data.json', '{}');
    expect(await readFile(path.join(root, 'survival', 'world', 'data.json'), 'utf8')).toBe('{}');
    expect((await files().list('')).find((entry) => entry.name === 'level')?.type).toBe('other');
  });

  it('keeps the folder inside the root', async () => {
    await symlink(outside, path.join(root, 'linked'));
    await expect(new FolderFiles(root, 'linked').read('secret.txt')).rejects.toMatchObject({
      code: 'folder_outside_root',
    });
    await expect(new FolderFiles(root, 'missing').read('x')).rejects.toMatchObject({
      code: 'folder_not_found',
    });
    await expect(
      new FolderFiles(path.join(root, 'no-root'), 'survival').read('x'),
    ).rejects.toMatchObject({ code: 'files_root_missing' });
  });
});

describe('testFolder', () => {
  it('passes for a server folder that Outpost can write', async () => {
    const result = await testFolder(root, 'survival', true);
    expect(result).toEqual({
      ok: true,
      steps: [
        {
          step: 'folder',
          ok: true,
          error: null,
          detail: await import('node:fs/promises').then(({ realpath }) =>
            realpath(path.join(root, 'survival')),
          ),
        },
        {
          step: 'properties',
          ok: true,
          error: null,
          detail: 'level-name=world, online-mode=false',
        },
        { step: 'write', ok: true, error: null, detail: null },
      ],
      hostKey: null,
    });
    expect(await readdir(path.join(root, 'survival'))).toEqual(['server.properties', 'world']);
  });

  it('checks reading only when writing is not wanted', async () => {
    const result = await testFolder(root, 'survival', false);
    expect(result.ok).toBe(true);
    expect(result.steps.map((step) => step.step)).toEqual(['folder', 'properties']);
  });

  it('names the first step that fails', async () => {
    expect((await testFolder(root, 'missing', true)).steps).toMatchObject([
      { step: 'folder', ok: false, error: 'folder_not_found' },
      { step: 'properties', ok: null },
      { step: 'write', ok: null },
    ]);
    await mkdir(path.join(root, 'empty'));
    expect((await testFolder(root, 'empty', false)).steps).toMatchObject([
      { step: 'folder', ok: true },
      { step: 'properties', ok: false, error: 'properties_not_found' },
    ]);
  });

  it.skipIf(isRoot)('fails the write step in a folder Outpost cannot write', async () => {
    await chmod(path.join(root, 'survival'), 0o555);
    const result = await testFolder(root, 'survival', true);
    expect(result.ok).toBe(false);
    expect(result.steps[2]).toMatchObject({ ok: false, error: 'files_permission_denied' });
  });
});
