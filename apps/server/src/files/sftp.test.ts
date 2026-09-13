import { posix } from 'node:path';
import { HOST_KEY_PATTERN } from '@outpost/shared';
import type { Stats } from 'ssh2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  openSftp,
  SftpFiles,
  SftpSessions,
  testSftp,
  type SftpSession,
  type SftpTarget,
} from './sftp.js';
import { createServerFolder, removeTree, sftpCall } from './test-sftp.js';

// Runs only against a real SFTP server; CI starts OpenSSH (atmoz/sftp) for it.
// OUTPOST_TEST_SFTP_URL=sftp://<user>:<password>@<host>:<port>/<writable folder>
const url = process.env['OUTPOST_TEST_SFTP_URL'];
const server = url === undefined ? undefined : new URL(url);

describe.skipIf(server === undefined)('SFTP against a real server', { timeout: 30_000 }, () => {
  const login = {
    host: server?.hostname ?? '',
    port: Number(server?.port || 22),
    username: decodeURIComponent(server?.username ?? ''),
    auth: 'password' as const,
    secret: decodeURIComponent(server?.password ?? ''),
  };
  let session: SftpSession;
  let folder: string;
  const target = (changes: Partial<SftpTarget> = {}): SftpTarget => ({
    ...login,
    path: folder,
    ...changes,
  });

  beforeAll(async () => {
    session = await openSftp({ ...login, path: '/' });
    folder = await createServerFolder(session.sftp, server?.pathname ?? '/');
  });

  afterAll(async () => {
    await removeTree(session.sftp, folder);
    session.client.end();
  });

  it('tests the connection step by step and reports the host key', async () => {
    const result = await testSftp(target(), true);
    expect(result.steps.map((step) => [step.step, step.ok, step.error])).toEqual([
      ['connect', true, null],
      ['auth', true, null],
      ['folder', true, null],
      ['properties', true, null],
      ['write', true, null],
    ]);
    expect(result.ok).toBe(true);
    expect(result.hostKey).toMatch(HOST_KEY_PATTERN);
    expect(result.steps[0]?.detail).toBe(result.hostKey);
    expect(result.steps[3]?.detail).toBe('level-name=world, online-mode=false');
    // The probe file is gone.
    const files = new SftpFiles(session.sftp, folder);
    expect((await files.list('')).map((entry) => entry.name)).toEqual([
      'server.properties',
      'world',
    ]);

    // With the right pinned key the test passes as well.
    expect((await testSftp(target({ hostKey: result.hostKey ?? '' }), false)).ok).toBe(true);
  });

  it('names the step that fails', async () => {
    expect((await testSftp(target({ secret: 'wrong password' }), false)).steps).toMatchObject([
      { step: 'connect', ok: true },
      { step: 'auth', ok: false, error: 'login_failed' },
      { step: 'folder', ok: null },
      { step: 'properties', ok: null },
    ]);

    const pinned = await testSftp(target({ hostKey: `SHA256:${'A'.repeat(43)}` }), false);
    expect(pinned.steps[0]).toMatchObject({ ok: false, error: 'host_key_mismatch' });
    // The key the server presented, so that the admin can compare and accept it.
    expect(pinned.hostKey).toMatch(HOST_KEY_PATTERN);
    expect(pinned.steps[0]?.detail).toBe(pinned.hostKey);

    expect((await testSftp(target({ path: `${folder}/missing` }), false)).steps[2]).toMatchObject({
      step: 'folder',
      ok: false,
      error: 'folder_not_found',
    });
    expect(
      (await testSftp(target({ auth: 'key', secret: 'not a key' }), false)).steps.slice(0, 2),
    ).toMatchObject([
      { step: 'connect', ok: null },
      { step: 'auth', ok: false, error: 'invalid_private_key' },
    ]);
  });

  it('reads, writes, stats and lists files inside the folder', async () => {
    const files = new SftpFiles(session.sftp, folder);
    await files.write('whitelist.json', '[]');
    await sftpCall((done) => session.sftp.chmod(`${folder}/whitelist.json`, 0o600, done));
    // Replacing an existing file keeps its mode.
    await files.write('whitelist.json', new TextEncoder().encode('[{"name":"Alex"}]'));
    expect(Buffer.from(await files.read('whitelist.json')).toString()).toBe('[{"name":"Alex"}]');
    const mode = await sftpCall<Stats>((done) =>
      session.sftp.stat(`${folder}/whitelist.json`, done),
    );
    expect(mode.mode & 0o777).toBe(0o600);

    expect(await files.stat('world')).toMatchObject({ type: 'directory', size: 0 });
    expect(await files.stat('missing.json')).toBeNull();
    expect((await files.list('')).map(({ name, type }) => ({ name, type }))).toEqual([
      { name: 'server.properties', type: 'file' },
      { name: 'whitelist.json', type: 'file' },
      { name: 'world', type: 'directory' },
    ]);
    await expect(files.read('world')).rejects.toMatchObject({ code: 'not_a_file' });
    await expect(files.read('missing.json')).rejects.toMatchObject({ code: 'file_not_found' });
    await expect(files.read('../server.properties')).rejects.toMatchObject({
      code: 'invalid_path',
    });

    // A link to the parent folder leads outside.
    await sftpCall((done) => session.sftp.symlink(posix.dirname(folder), `${folder}/escape`, done));
    await expect(files.list('escape')).rejects.toMatchObject({ code: 'path_outside_folder' });
    await expect(files.write('escape/x.txt', 'x')).rejects.toMatchObject({
      code: 'path_outside_folder',
    });
    await files.remove('whitelist.json');
    await sftpCall((done) => session.sftp.unlink(`${folder}/escape`, done));
  });

  it('reads a part of a file, and less at its end', async () => {
    const files = new SftpFiles(session.sftp, folder);
    await files.write('world/log.txt', 'hello world');
    const read = (offset: number, length: number) =>
      files.readRange('world/log.txt', offset, length).then((bytes) => bytes.toString());
    expect(await read(6, 5)).toBe('world');
    expect(await read(6, 100)).toBe('world');
    expect(await read(20, 5)).toBe('');
    await files.remove('world/log.txt');
  });

  // it('shares one session per server until the settings change', async () => {
  //   const sessions = new SftpSessions();
  //   try {
  //     const read = (changes: Partial<SftpTarget> = {}) =>
  //       sessions.use('server-1', target(changes), async (files) =>
  //         Buffer.from(await files.read('server.properties')).toString(),
  //       );
  //     const [first, second] = await Promise.all([read(), read()]);
  //     expect(first).toContain('level-name=world');
  //     expect(second).toBe(first);
  //     await expect(read({ secret: 'wrong password' })).rejects.toMatchObject({
  //       statusCode: 502,
  //       code: 'login_failed',
  //     });
  //     expect(await read()).toBe(first);
  //   } finally {
  //     sessions.closeAll();
  //   }
  // });
});
