import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { definePlugin, PLUGIN_API_VERSION } from '@outpost/plugin-api';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUserWithInvitation, get, send, setUpAdmin, startTestApp } from '../test-helpers.js';

// A module that uses ctx.files, as the modules of later versions will.
const filesProbe = definePlugin({
  id: 'test.files-probe',
  version: '1.0.0',
  apiVersion: PLUGIN_API_VERSION,
  files: { read: ['server.properties'], write: ['hello.txt'] },
  permissions: [{ key: 'files-probe.use', roles: ['owner'] }],
  setup(ctx) {
    ctx.http.serverRoute({
      method: 'GET',
      url: '/properties',
      permission: 'files-probe.use',
      capability: 'files.read',
      handler: async ({ server }) => ({
        text: new TextDecoder().decode(await ctx.files.read(server.id, 'server.properties')),
      }),
    });
    ctx.http.serverRoute({
      method: 'GET',
      url: '/ops',
      permission: 'files-probe.use',
      handler: async ({ server }) => ({
        text: new TextDecoder().decode(await ctx.files.read(server.id, 'ops.json')),
      }),
    });
    ctx.http.serverRoute({
      method: 'POST',
      url: '/write',
      permission: 'files-probe.use',
      handler: async ({ server }) => {
        await ctx.files.write(server.id, 'hello.txt', 'hi');
        return { written: true };
      },
    });
  },
});

let root: string;
let app: FastifyInstance | undefined;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'outpost-files-routes-'));
  await mkdir(path.join(root, 'survival'));
  await writeFile(path.join(root, 'survival', 'server.properties'), 'level-name=world\n');
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  await rm(root, { recursive: true, force: true });
});

async function setUp() {
  app = await startTestApp({
    env: { OUTPOST_REQUIRE_2FA_FOR_ADMINS: 'false', OUTPOST_FILES_ROOT: root },
    plugins: [filesProbe],
  });
  const server = app;
  const admin = await setUpAdmin(server);
  const created = await send(server, 'POST', '/api/v1/servers', {
    cookie: admin,
    body: { name: 'Survival', slug: 'survival', game: 'minecraft-java' },
  });
  const serverId = created.json<{ id: string }>().id;
  const owner = await createUserWithInvitation(server, admin, 'the-owner', {
    serverId,
    role: 'owner',
  });
  const url = `/api/v1/servers/${serverId}/files`;
  const save = (body: object, cookie = admin) => send(server, 'PUT', url, { cookie, body });
  const summary = async () =>
    (await get(server, `/api/v1/servers/${serverId}`, owner.cookie)).json<{
      connectors: string[];
      capabilities: string[];
    }>();
  const probe = (method: 'GET' | 'POST', probePath: string) =>
    method === 'GET'
      ? get(
          server,
          `/api/v1/servers/${serverId}/plugins/test.files-probe${probePath}`,
          owner.cookie,
        )
      : send(server, 'POST', `/api/v1/servers/${serverId}/plugins/test.files-probe${probePath}`, {
          cookie: owner.cookie,
        });
  return { server, admin, owner, serverId, url, save, summary, probe };
}

describe('the Files connector', () => {
  it('is managed by superadmins and tested before it is saved', async () => {
    const { server, admin, owner, url, save } = await setUp();
    const folder = { source: 'folder', path: 'survival', writable: false };

    expect((await save(folder, owner.cookie)).json()).toMatchObject({
      error: { code: 'forbidden' },
    });
    expect((await get(server, url, owner.cookie)).statusCode).toBe(403);
    expect((await get(server, url, admin)).json()).toEqual({ root, files: null });

    const tested = await send(server, 'POST', `${url}/test`, {
      cookie: admin,
      body: { ...folder, path: 'missing' },
    });
    expect(tested.json()).toMatchObject({
      ok: false,
      steps: [{ step: 'folder', ok: false, error: 'folder_not_found' }, { ok: null }],
    });

    const refused = await save({ ...folder, path: 'missing' });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({
      error: {
        code: 'files_test_failed',
        details: { ok: false, steps: [{ step: 'folder', error: 'folder_not_found' }, {}] },
      },
    });

    const traversal = await save({ ...folder, path: '../survival' });
    expect(traversal.json()).toMatchObject({ error: { code: 'validation_error' } });
  });

  it('adds files.read, and files.write when writing is on, for modules to use', async () => {
    const { server, admin, url, save, summary, probe, serverId } = await setUp();

    expect(await summary()).toMatchObject({ connectors: [], capabilities: [] });
    expect((await probe('GET', '/properties')).json()).toMatchObject({
      error: { code: 'capability_missing' },
    });

    expect((await save({ source: 'folder', path: 'survival', writable: false })).statusCode).toBe(
      204,
    );
    expect(await summary()).toMatchObject({
      connectors: ['files'],
      capabilities: ['files.read', 'logs.stream', 'game.events', 'stats.read'],
    });
    expect((await get(server, url, admin)).json()).toEqual({
      root,
      files: { source: 'folder', path: 'survival', writable: false },
    });
    expect((await probe('GET', '/properties')).json()).toEqual({ text: 'level-name=world\n' });
    // Modules use only the files they declare.
    expect((await probe('GET', '/ops')).json()).toMatchObject({
      error: { code: 'file_out_of_scope' },
    });
    // Writing needs files.write even where a route does not declare the capability.
    expect((await probe('POST', '/write')).json()).toMatchObject({
      error: { code: 'capability_missing' },
    });

    expect((await save({ source: 'folder', path: 'survival', writable: true })).statusCode).toBe(
      204,
    );
    expect(await summary()).toMatchObject({
      connectors: ['files'],
      capabilities: ['files.read', 'files.write', 'logs.stream', 'game.events', 'stats.read'],
    });
    expect((await probe('POST', '/write')).json()).toEqual({ written: true });
    expect(await readFile(path.join(root, 'survival', 'hello.txt'), 'utf8')).toBe('hi');

    const audit = await get(
      server,
      `/api/v1/audit?serverId=${serverId}&action=server.files`,
      admin,
    );
    expect(audit.json()).toMatchObject({
      entries: [
        { action: 'server.files_updated', details: { path: 'survival', writable: true } },
        { action: 'server.files_updated', details: { path: 'survival', writable: false } },
      ],
    });

    expect((await send(server, 'DELETE', url, { cookie: admin })).statusCode).toBe(204);
    expect(await summary()).toMatchObject({ connectors: [], capabilities: [] });
    expect((await probe('GET', '/properties')).statusCode).toBe(409);
  });
});
