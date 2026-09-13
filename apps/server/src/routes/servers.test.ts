import { definePlugin, PLUGIN_API_VERSION, type PluginContext } from '@outpost/plugin-api';
import type { RoleKey } from '@outpost/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createUserWithInvitation, get, send, setUpAdmin, startTestApp } from '../test-helpers.js';

let captured: PluginContext | undefined;

// A module with permissions of its own, like the players module will have.
const gamePlugin = definePlugin({
  id: 'test.game',
  version: '1.0.0',
  apiVersion: PLUGIN_API_VERSION,
  permissions: [
    { key: 'test.read', roles: ['owner', 'admin', 'moderator', 'viewer'] },
    { key: 'test.moderate', roles: ['owner', 'admin', 'moderator'] },
  ],
  setup(ctx) {
    captured = ctx;
    ctx.http.serverRoute({
      method: 'GET',
      url: '/read',
      permission: 'test.read',
      handler: ({ server, user, permissions }) => ({
        server: server.slug,
        user: user.username,
        canModerate: permissions.has('test.moderate'),
      }),
    });
    ctx.http.serverRoute({
      method: 'POST',
      url: '/kick',
      permission: 'test.moderate',
      handler: () => ({ kicked: true }),
    });
    ctx.http.serverRoute({
      method: 'POST',
      url: '/console',
      permission: 'test.moderate',
      capability: 'commands.send',
      handler: () => ({}),
    });
    ctx.http.serverRoute({
      method: 'GET',
      url: '/items/:item',
      permission: 'test.read',
      schema: { params: z.object({ item: z.string().regex(/^\d+$/) }) },
      handler: ({ params }) => ({ item: params.item }),
    });
  },
});

let app: FastifyInstance | undefined;
const start = async () => {
  app = await startTestApp({
    env: { OUTPOST_REQUIRE_2FA_FOR_ADMINS: 'false' },
    plugins: [gamePlugin],
  });
  return app;
};

afterEach(async () => {
  await app?.close();
  app = undefined;
  captured = undefined;
});

async function createServer(server: FastifyInstance, admin: string, slug = 'survival') {
  const response = await send(server, 'POST', '/api/v1/servers', {
    cookie: admin,
    body: { name: `Server ${slug}`, slug, game: 'minecraft-java' },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ id: string }>().id;
}

/** A server with one member per role plus an outsider. */
async function team(server: FastifyInstance) {
  const admin = await setUpAdmin(server);
  const serverId = await createServer(server, admin);
  const members = {} as Record<RoleKey | 'outsider', { cookie: string; id: string }>;
  for (const role of ['owner', 'admin', 'moderator', 'viewer'] as const) {
    members[role] = await createUserWithInvitation(server, admin, `the-${role}`, {
      serverId,
      role,
    });
  }
  members.outsider = await createUserWithInvitation(server, admin, 'outsider');
  return { admin, serverId, members };
}

describe('servers', () => {
  it('are created by superadmins and visible to their members only', async () => {
    const server = await start();
    const admin = await setUpAdmin(server);
    const serverId = await createServer(server, admin);
    const list = (cookie: string) =>
      get(server, '/api/v1/servers', cookie).then((response) => response.json());

    expect(await list(admin)).toMatchObject({
      servers: [{ id: serverId, slug: 'survival', role: null, connectors: [] }],
    });
    const taken = await send(server, 'POST', '/api/v1/servers', {
      cookie: admin,
      body: { name: 'Other', slug: 'survival', game: 'minecraft-java' },
    });
    expect(taken.json()).toMatchObject({ error: { code: 'slug_taken' } });

    const ann = await createUserWithInvitation(server, admin, 'ann');
    expect(await list(ann.cookie)).toEqual({ servers: [] });
    expect((await get(server, `/api/v1/servers/${serverId}`, ann.cookie)).statusCode).toBe(404);
    const create = await send(server, 'POST', '/api/v1/servers', {
      cookie: ann.cookie,
      body: { name: 'Mine', slug: 'mine', game: 'minecraft-java' },
    });
    expect(create.statusCode).toBe(403);

    await send(server, 'POST', `/api/v1/servers/${serverId}/members`, {
      cookie: admin,
      body: { username: 'ann', role: 'viewer' },
    });
    expect(await list(ann.cookie)).toMatchObject({
      servers: [{ slug: 'survival', role: 'viewer', permissions: ['server.view', 'test.read'] }],
    });
  });

  it('answer every route according to the role (a viewer cannot call moderator APIs)', async () => {
    const server = await start();
    const { serverId, members } = await team(server);
    const base = `/api/v1/servers/${serverId}`;
    const routes: {
      method: 'GET' | 'POST' | 'PATCH';
      url: string;
      body?: object;
      allowed: RoleKey[];
    }[] = [
      { method: 'GET', url: base, allowed: ['owner', 'admin', 'moderator', 'viewer'] },
      { method: 'PATCH', url: base, body: { name: 'Renamed' }, allowed: ['owner'] },
      { method: 'GET', url: `${base}/members`, allowed: ['owner', 'admin'] },
      {
        method: 'POST',
        url: `${base}/members`,
        // Passes the permission check, then fails as a duplicate: repeatable for every role.
        body: { username: 'the-viewer', role: 'viewer' },
        allowed: ['owner', 'admin'],
      },
      { method: 'GET', url: `${base}/invitations`, allowed: ['owner', 'admin'] },
      {
        method: 'POST',
        url: `${base}/invitations`,
        body: { role: 'viewer', expiresInDays: 1 },
        allowed: ['owner', 'admin'],
      },
      { method: 'GET', url: `${base}/audit`, allowed: ['owner', 'admin'] },
      {
        method: 'GET',
        url: `${base}/plugins/test.game/read`,
        allowed: ['owner', 'admin', 'moderator', 'viewer'],
      },
      {
        method: 'POST',
        url: `${base}/plugins/test.game/kick`,
        allowed: ['owner', 'admin', 'moderator'],
      },
    ];

    for (const route of routes) {
      for (const role of ['owner', 'admin', 'moderator', 'viewer'] as const) {
        const { cookie } = members[role];
        const response =
          route.method === 'GET'
            ? await get(server, route.url, cookie)
            : await send(server, route.method, route.url, {
                cookie,
                ...(route.body && { body: route.body }),
              });
        const label = `${role} ${route.method} ${route.url}: ${response.body}`;
        if (route.allowed.includes(role))
          expect([403, 404], label).not.toContain(response.statusCode);
        else expect(response.statusCode, label).toBe(403);
      }
      const outsider =
        route.method === 'GET'
          ? await get(server, route.url, members.outsider.cookie)
          : await send(server, route.method, route.url, {
              cookie: members.outsider.cookie,
              ...(route.body && { body: route.body }),
            });
      expect(outsider.statusCode, `outsider ${route.method} ${route.url}`).toBe(404);
    }

    // Adding members is allowed to owners and admins; the table above adds nobody twice.
    const added = await send(server, 'POST', `${base}/members`, {
      cookie: members.admin.cookie,
      body: { username: 'outsider', role: 'viewer' },
    });
    expect(added.statusCode).toBe(201);
    const deleted = await send(server, 'DELETE', base, { cookie: members.admin.cookie });
    expect(deleted.statusCode).toBe(403);
  });

  it('let admins manage only moderators and viewers', async () => {
    const server = await start();
    const { serverId, members } = await team(server);
    const base = `/api/v1/servers/${serverId}/members`;
    const asAdmin = { cookie: members.admin.cookie };

    const list = (await get(server, base, members.admin.cookie)).json<{
      members: { username: string; manageable: boolean }[];
      assignableRoles: string[];
    }>();
    expect(list.assignableRoles).toEqual(['moderator', 'viewer']);
    expect(Object.fromEntries(list.members.map((m) => [m.username, m.manageable]))).toEqual({
      'the-admin': false,
      'the-moderator': true,
      'the-owner': false,
      'the-viewer': true,
    });

    const addAdmin = await send(server, 'POST', base, {
      ...asAdmin,
      body: { username: 'outsider', role: 'admin' },
    });
    expect(addAdmin.json()).toMatchObject({ error: { code: 'role_not_allowed' } });
    const promote = await send(server, 'PATCH', `${base}/${members.viewer.id}`, {
      ...asAdmin,
      body: { role: 'admin' },
    });
    expect(promote.statusCode).toBe(403);
    const change = await send(server, 'PATCH', `${base}/${members.viewer.id}`, {
      ...asAdmin,
      body: { role: 'moderator' },
    });
    expect(change.statusCode).toBe(204);
    const removeOwner = await send(server, 'DELETE', `${base}/${members.owner.id}`, asAdmin);
    expect(removeOwner.statusCode).toBe(403);
    const ownerInvite = await send(server, 'POST', `/api/v1/servers/${serverId}/invitations`, {
      ...asAdmin,
      body: { role: 'owner', expiresInDays: 7 },
    });
    expect(ownerInvite.json()).toMatchObject({ error: { code: 'role_not_allowed' } });

    // Owners manage every role, including other owners.
    const coOwner = await send(server, 'PATCH', `${base}/${members.admin.id}`, {
      cookie: members.owner.cookie,
      body: { role: 'owner' },
    });
    expect(coOwner.statusCode).toBe(204);
    const removed = await send(server, 'DELETE', `${base}/${members.moderator.id}`, {
      cookie: members.owner.cookie,
    });
    expect(removed.statusCode).toBe(204);
    expect(
      (await get(server, `/api/v1/servers/${serverId}`, members.moderator.cookie)).statusCode,
    ).toBe(404);

    const unknown = await send(server, 'POST', base, {
      cookie: members.owner.cookie,
      body: { username: 'nobody', role: 'viewer' },
    });
    expect(unknown.json()).toMatchObject({ error: { code: 'user_not_found' } });
    const twice = await send(server, 'POST', base, {
      cookie: members.owner.cookie,
      body: { username: 'the-viewer', role: 'viewer' },
    });
    expect(twice.json()).toMatchObject({ error: { code: 'already_member' } });
  });

  it('invite people who become members with the role of the invitation', async () => {
    const server = await start();
    const { serverId, members } = await team(server);
    const created = await send(server, 'POST', `/api/v1/servers/${serverId}/invitations`, {
      cookie: members.admin.cookie,
      body: { role: 'moderator', expiresInDays: 7, note: 'New moderator' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const { url, invitation } = created.json<{ url: string; invitation: object }>();
    expect(invitation).toMatchObject({ serverId, role: 'moderator', createdBy: 'the-admin' });
    const token = url.split('/').pop() ?? '';

    expect((await get(server, `/api/v1/invite/${token}`)).json()).toMatchObject({
      serverName: 'Server survival',
      role: 'moderator',
      invitedBy: 'the-admin',
    });
    const accepted = await send(server, 'POST', `/api/v1/invite/${token}/accept`, {
      body: { username: 'newbie', password: 'a long enough passphrase' },
    });
    expect(accepted.statusCode, accepted.body).toBe(201);
    const cookie = `outpost_session=${accepted.cookies.find((c) => c.name === 'outpost_session')?.value}`;
    expect((await get(server, '/api/v1/servers', cookie)).json()).toMatchObject({
      servers: [{ id: serverId, role: 'moderator' }],
    });
    expect(
      (await get(server, `/api/v1/servers/${serverId}/invitations`, members.owner.cookie)).json(),
    ).toMatchObject({
      invitations: expect.arrayContaining([
        expect.objectContaining({
          status: 'used',
          usedBy: 'newbie',
          serverName: 'Server survival',
        }),
      ]),
    });
    // Server invitations stay within their server; the instance list shows them to superadmins.
    expect((await get(server, '/api/v1/invitations', members.owner.cookie)).statusCode).toBe(403);
  });

  it('check capabilities and parameters of plugin server routes', async () => {
    const server = await start();
    const { serverId, members } = await team(server);
    const base = `/api/v1/servers/${serverId}/plugins/test.game`;
    const noCapability = await send(server, 'POST', `${base}/console`, {
      cookie: members.owner.cookie,
    });
    expect(noCapability.statusCode).toBe(409);
    expect(noCapability.json()).toMatchObject({ error: { code: 'capability_missing' } });
    expect((await get(server, `${base}/items/abc`, members.viewer.cookie)).statusCode).toBe(400);
    expect((await get(server, `${base}/items/12`, members.viewer.cookie)).json()).toEqual({
      item: '12',
    });
    expect((await get(server, `${base}/read`, members.viewer.cookie)).json()).toEqual({
      server: 'survival',
      user: 'the-viewer',
      canModerate: false,
    });
    expect(
      (await get(server, '/api/v1/servers/nope/plugins/test.game/read', members.owner.cookie))
        .statusCode,
    ).toBe(404);
  });

  it('share the general rate limit on plugin server routes', async () => {
    const server = await start();
    const { serverId, members } = await team(server);
    const hit = () =>
      get(server, `/api/v1/servers/${serverId}/plugins/test.game/read`, members.viewer.cookie);
    const first = await hit();
    expect(first.headers['x-ratelimit-limit']).toBe('600');
    const remaining = Number(first.headers['x-ratelimit-remaining']);
    for (let i = 0; i < remaining; i++) await hit();
    const limited = await hit();
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: 'rate_limited' } });
  });

  it('are renamed and deleted by owners; the audit log keeps their history', async () => {
    const server = await start();
    const { admin, serverId, members } = await team(server);
    const base = `/api/v1/servers/${serverId}`;
    const renamed = await send(server, 'PATCH', base, {
      cookie: members.owner.cookie,
      body: { name: 'Creative', slug: 'creative' },
    });
    expect(renamed.statusCode).toBe(204);
    expect((await get(server, base, members.viewer.cookie)).json()).toMatchObject({
      name: 'Creative',
      slug: 'creative',
    });

    const deleted = await send(server, 'DELETE', base, { cookie: members.owner.cookie });
    expect(deleted.statusCode).toBe(204);
    expect((await get(server, base, members.owner.cookie)).statusCode).toBe(404);
    expect((await get(server, '/api/v1/servers', members.viewer.cookie)).json()).toEqual({
      servers: [],
    });
    const audit = await get(server, `/api/v1/audit?serverId=${serverId}&action=server.`, admin);
    expect(audit.json<{ entries: { action: string }[] }>().entries.map((e) => e.action)).toEqual([
      'server.deleted',
      'server.updated',
      'server.created',
    ]);
  });
});

describe('audit log', () => {
  it('is readable per server by owners and admins, and for the whole instance by superadmins', async () => {
    const server = await start();
    const { admin, serverId, members } = await team(server);
    const otherId = await createServer(server, admin, 'other');

    const serverAudit = (
      await get(server, `/api/v1/servers/${serverId}/audit`, members.admin.cookie)
    ).json<{
      entries: { serverId: string; action: string }[];
    }>();
    expect(serverAudit.entries.length).toBeGreaterThan(0);
    expect(serverAudit.entries.every((entry) => entry.serverId === serverId)).toBe(true);

    expect((await get(server, '/api/v1/audit', members.owner.cookie)).statusCode).toBe(403);
    const other = (await get(server, `/api/v1/audit?serverId=${otherId}`, admin)).json();
    expect(other).toMatchObject({
      entries: [{ action: 'server.created', serverName: 'Server other', username: 'admin' }],
      nextCursor: null,
    });

    // Pages of two, continued with the cursor.
    const first = (await get(server, '/api/v1/audit?limit=2', admin)).json<{
      entries: { id: string }[];
      nextCursor: string;
    }>();
    expect(first.entries).toHaveLength(2);
    const second = (
      await get(
        server,
        `/api/v1/audit?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
        admin,
      )
    ).json<{ entries: { id: string }[] }>();
    expect(second.entries).toHaveLength(2);
    expect(second.entries.map((e) => e.id)).not.toContain(first.entries[0]?.id);
    expect((await get(server, '/api/v1/audit?cursor=bad', admin)).statusCode).toBe(400);
    const byUser = (await get(server, '/api/v1/audit?username=the-viewer', admin)).json<{
      entries: { username: string }[];
    }>();
    expect(byUser.entries.length).toBeGreaterThan(0);
    expect(byUser.entries.every((entry) => entry.username === 'the-viewer')).toBe(true);
  });
});

describe('plugin access to servers', () => {
  it('declares permissions for the built-in roles and checks them for plugins', async () => {
    const server = await start();
    const { serverId, members } = await team(server);
    const roles = (await get(server, '/api/v1/roles', members.viewer.cookie)).json<{
      roles: { key: string; permissions: string[] }[];
    }>();
    expect(roles.roles.find((role) => role.key === 'moderator')?.permissions).toEqual([
      'server.view',
      'test.moderate',
      'test.read',
    ]);

    const plugin = captured;
    if (plugin === undefined) throw new Error('The test plugin was not set up');
    expect(await plugin.permissions.has(members.viewer.id, serverId, 'test.moderate')).toBe(false);
    expect(await plugin.permissions.has(members.moderator.id, serverId, 'test.moderate')).toBe(
      true,
    );
    expect(await plugin.permissions.has(members.outsider.id, serverId, 'test.read')).toBe(false);
    expect(await plugin.servers.list()).toEqual([
      {
        id: serverId,
        slug: 'survival',
        name: 'Server survival',
        game: 'minecraft-java',
        capabilities: [],
      },
    ]);
    const sealed = plugin.secrets.seal('rcon password');
    expect(sealed).not.toContain('rcon');
    expect(plugin.secrets.open(sealed)).toBe('rcon password');
  });

  it('rejects conflicting permissions and routes with unknown permissions', async () => {
    const clash = definePlugin({
      id: 'test.clash',
      version: '1.0.0',
      apiVersion: PLUGIN_API_VERSION,
      permissions: [{ key: 'server.view', roles: ['viewer'] }],
    });
    await expect(startTestApp({ plugins: [clash] })).rejects.toThrow(
      /"server.view" of plugin "test.clash" is already declared by the core/,
    );

    const unknown = definePlugin({
      id: 'test.unknown',
      version: '1.0.0',
      apiVersion: PLUGIN_API_VERSION,
      setup(ctx) {
        ctx.http.serverRoute({
          method: 'GET',
          url: '/x',
          permission: 'nope.read',
          handler: () => ({}),
        });
      },
    });
    await expect(startTestApp({ plugins: [unknown] })).rejects.toThrow(
      /unknown permission "nope.read"/,
    );
  });
});
