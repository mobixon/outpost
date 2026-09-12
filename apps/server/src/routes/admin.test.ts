import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { totpAt } from '../auth/totp.js';
import {
  get,
  send,
  sessionCookie,
  setUpAdmin,
  startTestApp,
  TEST_PASSWORD,
} from '../test-helpers.js';

let app: FastifyInstance | undefined;
const start = async () => {
  app = await startTestApp({ env: { OUTPOST_REQUIRE_2FA_FOR_ADMINS: 'false' } });
  return app;
};

afterEach(async () => {
  vi.useRealTimers();
  await app?.close();
  app = undefined;
});

interface Created {
  url: string;
  invitation: { id: string };
}

async function createInvitation(
  server: FastifyInstance,
  cookie: string,
  body: object = { isSuperadmin: false, expiresInDays: 7 },
) {
  const response = await send(server, 'POST', '/api/v1/invitations', { cookie, body });
  expect(response.statusCode, response.body).toBe(201);
  const created = response.json<Created>();
  return { ...created, token: created.url.split('/').pop() ?? '' };
}

/** Invites a user who accepts with a password; returns their session cookie and id. */
async function inviteUser(server: FastifyInstance, admin: string, username: string) {
  const { token } = await createInvitation(server, admin);
  const accepted = await send(server, 'POST', `/api/v1/invite/${token}/accept`, {
    body: { username, password: TEST_PASSWORD },
  });
  expect(accepted.statusCode, accepted.body).toBe(201);
  const cookie = sessionCookie(accepted);
  const { id } = (await get(server, '/api/v1/me', cookie)).json<{ id: string }>();
  return { cookie, id };
}

const login = (server: FastifyInstance, username: string) =>
  send(server, 'POST', '/api/v1/auth/login', { body: { username, password: TEST_PASSWORD } });

describe('invitations', () => {
  it('let superadmins invite people who choose a username and password', async () => {
    const server = await start();
    const admin = await setUpAdmin(server);
    const { url, token } = await createInvitation(server, admin, {
      isSuperadmin: false,
      expiresInDays: 7,
      note: 'For Ann',
    });
    expect(url).toMatch(/^http:\/\/localhost:3000\/invite\/[\w-]{43}$/);

    expect((await get(server, `/api/v1/invite/${token}`)).json()).toMatchObject({
      isSuperadmin: false,
      invitedBy: 'admin',
    });
    const accept = (username: string) =>
      send(server, 'POST', `/api/v1/invite/${token}/accept`, {
        body: { username, password: TEST_PASSWORD },
      });
    expect((await accept('admin')).json()).toMatchObject({ error: { code: 'username_taken' } });
    const accepted = await accept('ann');
    expect(accepted.json()).toEqual({ status: 'active' });
    expect((await get(server, '/api/v1/me', sessionCookie(accepted))).json()).toMatchObject({
      username: 'ann',
      isSuperadmin: false,
      hasPassword: true,
    });

    // Used up.
    expect((await accept('ann2')).json()).toMatchObject({ error: { code: 'invitation_invalid' } });
    expect((await get(server, `/api/v1/invite/${token}`)).statusCode).toBe(404);
    expect((await get(server, '/api/v1/invitations', admin)).json()).toMatchObject({
      invitations: [{ status: 'used', usedBy: 'ann', createdBy: 'admin', note: 'For Ann' }],
    });
  });

  it('can make the new account a superadmin', async () => {
    const server = await start();
    const admin = await setUpAdmin(server);
    const { token } = await createInvitation(server, admin, {
      isSuperadmin: true,
      expiresInDays: 1,
    });
    const accepted = await send(server, 'POST', `/api/v1/invite/${token}/accept`, {
      body: { username: 'second-admin', password: TEST_PASSWORD },
    });
    expect((await get(server, '/api/v1/me', sessionCookie(accepted))).json()).toMatchObject({
      isSuperadmin: true,
    });
  });

  it('expire, can be withdrawn and need sudo mode to be created', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const server = await start();
    const admin = await setUpAdmin(server);
    const shortLived = await createInvitation(server, admin, {
      isSuperadmin: false,
      expiresInDays: 1,
    });
    const withdrawn = await createInvitation(server, admin);

    const removed = await send(server, 'DELETE', `/api/v1/invitations/${withdrawn.invitation.id}`, {
      cookie: admin,
    });
    expect(removed.statusCode).toBe(204);
    expect((await get(server, `/api/v1/invite/${withdrawn.token}`)).statusCode).toBe(404);

    vi.setSystemTime(Date.now() + 25 * 60 * 60_000);
    expect((await get(server, `/api/v1/invite/${shortLived.token}`)).statusCode).toBe(404);
    expect((await get(server, '/api/v1/invitations', admin)).json()).toMatchObject({
      invitations: [{ status: 'expired' }],
    });
    const late = await send(server, 'POST', '/api/v1/invitations', {
      cookie: admin,
      body: { isSuperadmin: false, expiresInDays: 7 },
    });
    expect(late.json()).toMatchObject({ error: { code: 'sudo_required' } });
  });

  it('are managed by superadmins only', async () => {
    const server = await start();
    const admin = await setUpAdmin(server);
    const ann = await inviteUser(server, admin, 'ann');
    expect((await get(server, '/api/v1/invitations', ann.cookie)).statusCode).toBe(403);
    const create = await send(server, 'POST', '/api/v1/invitations', {
      cookie: ann.cookie,
      body: { isSuperadmin: true, expiresInDays: 30 },
    });
    expect(create.json()).toMatchObject({ error: { code: 'forbidden' } });
  });
});

describe('user management', () => {
  it('lists users and lets superadmins disable, promote and delete them', async () => {
    const server = await start();
    const admin = await setUpAdmin(server);
    const ann = await inviteUser(server, admin, 'ann');

    expect((await get(server, '/api/v1/users', admin)).json()).toMatchObject({
      users: [
        { username: 'admin', isSuperadmin: true, hasPassword: true, disabled: false },
        { username: 'ann', isSuperadmin: false, providers: [], lastSeenAt: expect.any(String) },
      ],
    });
    expect((await get(server, '/api/v1/users', ann.cookie)).statusCode).toBe(403);

    const update = (id: string, body: object) =>
      send(server, 'PATCH', `/api/v1/users/${id}`, { cookie: admin, body });
    expect((await update(ann.id, { disabled: true })).statusCode).toBe(204);
    expect((await get(server, '/api/v1/me', ann.cookie)).statusCode).toBe(401);
    expect((await login(server, 'ann')).statusCode).toBe(401);

    expect((await update(ann.id, { disabled: false, isSuperadmin: true })).statusCode).toBe(204);
    const annAgain = sessionCookie(await login(server, 'ann'));
    expect((await get(server, '/api/v1/users', annAgain)).statusCode).toBe(200);

    const { id: adminId } = (await get(server, '/api/v1/me', admin)).json<{ id: string }>();
    expect((await update(adminId, { disabled: true })).json()).toMatchObject({
      error: { code: 'own_account' },
    });

    const removed = await send(server, 'DELETE', `/api/v1/users/${ann.id}`, { cookie: admin });
    expect(removed.statusCode).toBe(204);
    expect((await get(server, '/api/v1/users', admin)).json()).toMatchObject({
      users: [{ username: 'admin' }],
    });
    expect(
      (await get(server, '/api/v1/users', admin)).json<{ users: unknown[] }>().users,
    ).toHaveLength(1);
  });

  it('resets the two-factor authentication of a user who lost the authenticator', async () => {
    const server = await start();
    const admin = await setUpAdmin(server);
    const ann = await inviteUser(server, admin, 'ann');
    const { secret } = (
      await send(server, 'POST', '/api/v1/me/2fa/setup', { cookie: ann.cookie })
    ).json<{
      secret: string;
    }>();
    await send(server, 'POST', '/api/v1/me/2fa/enable', {
      cookie: ann.cookie,
      body: { code: totpAt(secret, Date.now()) },
    });
    expect((await login(server, 'ann')).json()).toEqual({ status: 'mfa' });

    const reset = await send(server, 'POST', `/api/v1/users/${ann.id}/2fa/reset`, {
      cookie: admin,
    });
    expect(reset.statusCode).toBe(204);
    expect((await get(server, '/api/v1/me', ann.cookie)).statusCode).toBe(401);
    expect((await login(server, 'ann')).json()).toEqual({ status: 'active' });
  });
});
