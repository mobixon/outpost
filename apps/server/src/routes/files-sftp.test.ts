import { definePlugin, PLUGIN_API_VERSION } from '@outpost/plugin-api';
import { HOST_KEY_PATTERN } from '@outpost/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { openSftp, type SftpSession } from '../files/sftp.js';
import { createServerFolder, removeTree, sftpCall } from '../files/test-sftp.js';
import { createUserWithInvitation, get, send, setUpAdmin, startTestApp } from '../test-helpers.js';

// Runs only against a real SFTP server, see files/sftp.test.ts.
const url = process.env['OUTPOST_TEST_SFTP_URL'];
const server = url === undefined ? undefined : new URL(url);

const filesProbe = definePlugin({
  id: 'test.files-probe',
  version: '1.0.0',
  apiVersion: PLUGIN_API_VERSION,
  permissions: [{ key: 'files-probe.use', roles: ['owner'] }],
  setup(ctx) {
    ctx.http.serverRoute({
      method: 'GET',
      url: '/properties',
      permission: 'files-probe.use',
      capability: 'files.read',
      handler: async ({ server: game }) => ({
        text: new TextDecoder().decode(await ctx.files.read(game.id, 'server.properties')),
      }),
    });
    ctx.http.serverRoute({
      method: 'POST',
      url: '/write',
      permission: 'files-probe.use',
      capability: 'files.write',
      handler: async ({ server: game }) => {
        await ctx.files.write(game.id, 'hello.txt', 'hi');
        return { written: true };
      },
    });
  },
});

let app: FastifyInstance | undefined;
let session: SftpSession | undefined;
let folder: string | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  if (session !== undefined && folder !== undefined) await removeTree(session.sftp, folder);
  session?.client.end();
  session = undefined;
});

describe.skipIf(server === undefined)('the Files connector over SFTP', { timeout: 30_000 }, () => {
  const login = {
    host: server?.hostname ?? '',
    port: Number(server?.port || 22),
    username: decodeURIComponent(server?.username ?? ''),
  };
  const secret = decodeURIComponent(server?.password ?? '');

  it('pins the host key, keeps the password and serves the files to modules', async () => {
    session = await openSftp({ ...login, auth: 'password', secret, path: '/' });
    folder = await createServerFolder(session.sftp, server?.pathname ?? '/');
    app = await startTestApp({
      env: { OUTPOST_REQUIRE_2FA_FOR_ADMINS: 'false' },
      plugins: [filesProbe],
    });
    const outpost = app;
    const admin = await setUpAdmin(outpost);
    const created = await send(outpost, 'POST', '/api/v1/servers', {
      cookie: admin,
      body: { name: 'Survival', slug: 'survival', game: 'minecraft-java' },
    });
    const serverId = created.json<{ id: string }>().id;
    const owner = await createUserWithInvitation(outpost, admin, 'the-owner', {
      serverId,
      role: 'owner',
    });
    const path = `/api/v1/servers/${serverId}/files`;
    const input = {
      source: 'sftp',
      ...login,
      auth: 'password',
      secret,
      path: folder,
      writable: true,
    };
    const save = (body: object) => send(outpost, 'PUT', path, { cookie: admin, body });
    const probe = (method: 'GET' | 'POST', url: string) =>
      method === 'GET'
        ? get(outpost, `/api/v1/servers/${serverId}/plugins/test.files-probe${url}`, owner.cookie)
        : send(outpost, 'POST', `/api/v1/servers/${serverId}/plugins/test.files-probe${url}`, {
            cookie: owner.cookie,
          });

    // The host key must be confirmed after a test.
    expect((await save(input)).json()).toMatchObject({ error: { code: 'host_key_required' } });
    const tested = await send(outpost, 'POST', `${path}/test`, { cookie: admin, body: input });
    const { ok, hostKey } = tested.json<{ ok: boolean; hostKey: string }>();
    expect(ok).toBe(true);
    expect(hostKey).toMatch(HOST_KEY_PATTERN);

    expect((await save({ ...input, hostKey })).statusCode).toBe(204);
    const state = await get(outpost, path, admin);
    expect(state.json()).toMatchObject({
      files: { source: 'sftp', ...login, auth: 'password', path: folder, writable: true, hostKey },
    });
    expect(state.body).not.toContain(secret);
    expect((await get(outpost, `/api/v1/servers/${serverId}`, owner.cookie)).json()).toMatchObject({
      connectors: ['files'],
      capabilities: ['files.read', 'files.write', 'logs.stream'],
    });

    expect((await probe('GET', '/properties')).json()).toEqual({
      text: 'level-name=world\nonline-mode=false\n',
    });
    expect((await probe('POST', '/write')).json()).toEqual({ written: true });
    const written = await sftpCall<Buffer>((done) =>
      session?.sftp.readFile(`${folder}/hello.txt`, done),
    );
    expect(written.toString()).toBe('hi');

    // The stored password and the pinned key stay while host, port and username do.
    expect((await save({ ...input, secret: undefined, writable: false })).statusCode).toBe(204);
    expect((await get(outpost, `/api/v1/servers/${serverId}`, owner.cookie)).json()).toMatchObject({
      capabilities: ['files.read', 'logs.stream'],
    });
    expect((await probe('POST', '/write')).statusCode).toBe(409);

    // Another key is refused, with the key the server presented.
    const refused = await save({ ...input, hostKey: `SHA256:${'A'.repeat(43)}` });
    expect(refused.json()).toMatchObject({
      error: {
        code: 'files_test_failed',
        details: {
          hostKey,
          steps: [{ step: 'connect', ok: false, error: 'host_key_mismatch' }, {}, {}, {}, {}],
        },
      },
    });

    const audit = await get(
      outpost,
      `/api/v1/audit?serverId=${serverId}&action=server.files`,
      admin,
    );
    expect(audit.body).not.toContain(secret);
    expect(audit.json()).toMatchObject({
      entries: [
        { details: { source: 'sftp', secretChanged: false, writable: false } },
        { details: { source: 'sftp', secretChanged: true, hostKey } },
      ],
    });
  });
});
