import { definePlugin, PLUGIN_API_VERSION } from '@outpost/plugin-api';
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
  TEST_SETUP_TOKEN,
} from '../test-helpers.js';

// Exposes the audit log to the tests.
const auditReader = definePlugin({
  id: 'test.audit',
  version: '1.0.0',
  apiVersion: PLUGIN_API_VERSION,
  setup(ctx) {
    const db = ctx.db<{ audit_log: { action: string } }>();
    ctx.http.route({
      method: 'GET',
      url: '/actions',
      access: 'public',
      handler: async () =>
        (await db.selectFrom('audit_log').select('action').execute()).map((row) => row.action),
    });
  },
});

let server: FastifyInstance | undefined;
const start = async (env: Record<string, string> = {}) => {
  server = await startTestApp({ env, plugins: [auditReader] });
  return server;
};
const without2faRequirement = { OUTPOST_REQUIRE_2FA_FOR_ADMINS: 'false' };

afterEach(async () => {
  vi.useRealTimers();
  await server?.close();
  server = undefined;
});

const login = (app: FastifyInstance, password = TEST_PASSWORD, username = 'admin') =>
  send(app, 'POST', '/api/v1/auth/login', { body: { username, password } });

async function enableTwoFactor(app: FastifyInstance, cookie: string) {
  const setup = await send(app, 'POST', '/api/v1/me/2fa/setup', { cookie });
  expect(setup.statusCode).toBe(200);
  const { secret, uri } = setup.json<{ secret: string; uri: string }>();
  expect(uri).toContain(`secret=${secret}`);

  const wrong = await send(app, 'POST', '/api/v1/me/2fa/enable', {
    cookie,
    body: { code: '000000' },
  });
  expect(wrong.statusCode).toBe(400);

  const enabledAt = Date.now();
  const code = totpAt(secret, enabledAt);
  const enabled = await send(app, 'POST', '/api/v1/me/2fa/enable', { cookie, body: { code } });
  expect(enabled.statusCode).toBe(200);
  return {
    secret,
    code,
    enabledAt,
    backupCodes: enabled.json<{ backupCodes: string[] }>().backupCodes,
  };
}

/** Signs in with password and second factor and returns the session cookie. */
async function loginWithCode(app: FastifyInstance, code: string) {
  const first = await login(app);
  expect(first.json()).toEqual({ status: 'mfa' });
  const second = await send(app, 'POST', '/api/v1/auth/login/2fa', {
    cookie: sessionCookie(first),
    body: { code },
  });
  return { response: second, pendingCookie: sessionCookie(first) };
}

describe('first-run setup', () => {
  it('needs the setup token and creates a superadmin', async () => {
    const app = await start();
    expect((await get(app, '/api/v1/auth/session')).json()).toMatchObject({
      setupRequired: true,
      status: 'anonymous',
      user: null,
    });

    const setup = (body: object) => send(app, 'POST', '/api/v1/setup', { body });
    const wrongToken = await setup({ token: 'wrong', username: 'admin', password: TEST_PASSWORD });
    expect(wrongToken.statusCode).toBe(403);
    expect(wrongToken.json()).toMatchObject({ error: { code: 'invalid_setup_token' } });

    const badName = await setup({
      token: TEST_SETUP_TOKEN,
      username: 'a!',
      password: TEST_PASSWORD,
    });
    expect(badName.json()).toMatchObject({ error: { code: 'validation_error' } });

    const weak = await setup({
      token: TEST_SETUP_TOKEN,
      username: 'admin',
      password: 'my-admin-password',
    });
    expect(weak.json()).toMatchObject({ error: { code: 'password_contains_username' } });

    const created = await setup({
      token: TEST_SETUP_TOKEN,
      username: ' Admin ',
      password: TEST_PASSWORD,
    });
    expect(created.statusCode).toBe(201);
    const cookie = sessionCookie(created);

    const again = await setup({
      token: TEST_SETUP_TOKEN,
      username: 'other',
      password: TEST_PASSWORD,
    });
    expect(again.json()).toMatchObject({ error: { code: 'already_set_up' } });

    expect((await get(app, '/api/v1/auth/session', cookie)).json()).toMatchObject({
      setupRequired: false,
      status: 'active',
      user: { username: 'admin', isSuperadmin: true, twoFactorEnabled: false },
      twoFactorEnrollmentRequired: true,
      sudoUntil: expect.any(String),
    });
  });

  it('keeps administrators on the account pages until two-factor authentication is on', async () => {
    const app = await start();
    const cookie = await setUpAdmin(app);
    const blocked = await get(app, '/api/v1/plugins', cookie);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ error: { code: 'two_factor_enrollment_required' } });
    expect((await get(app, '/api/v1/me', cookie)).statusCode).toBe(200);

    await enableTwoFactor(app, cookie);
    expect((await get(app, '/api/v1/plugins', cookie)).statusCode).toBe(200);
    expect((await get(app, '/api/v1/auth/session', cookie)).json()).toMatchObject({
      twoFactorEnrollmentRequired: false,
      user: { twoFactorEnabled: true, backupCodesLeft: 10 },
    });
  });
});

describe('login with two-factor authentication', () => {
  it('asks for a code after the password and rejects replayed codes', async () => {
    const app = await start();
    const cookie = await setUpAdmin(app);
    const { secret, code, enabledAt } = await enableTwoFactor(app, cookie);

    expect((await send(app, 'POST', '/api/v1/auth/logout', { cookie })).statusCode).toBe(204);
    expect((await get(app, '/api/v1/me', cookie)).statusCode).toBe(401);

    const wrongPassword = await login(app, 'not the password');
    expect(wrongPassword.statusCode).toBe(401);
    expect(wrongPassword.json()).toMatchObject({ error: { code: 'invalid_credentials' } });

    const first = await login(app);
    const pending = sessionCookie(first);
    expect((await get(app, '/api/v1/auth/session', pending)).json()).toMatchObject({
      status: 'mfa',
      user: null,
    });
    expect((await get(app, '/api/v1/me', pending)).statusCode).toBe(401);

    // The code used to enable 2FA was just accepted, so it cannot be used again.
    const replay = await send(app, 'POST', '/api/v1/auth/login/2fa', {
      cookie: pending,
      body: { code },
    });
    expect(replay.json()).toMatchObject({ error: { code: 'invalid_code' } });

    // The code of the next time step, also when a step boundary has passed since.
    const next = await send(app, 'POST', '/api/v1/auth/login/2fa', {
      cookie: pending,
      body: { code: totpAt(secret, enabledAt + 30_000) },
    });
    expect(next.json()).toEqual({ status: 'active' });
    expect((await get(app, '/api/v1/me', sessionCookie(next))).statusCode).toBe(200);
    // The pending session was replaced by a new one.
    expect((await get(app, '/api/v1/auth/session', pending)).json()).toMatchObject({
      status: 'anonymous',
    });
  });

  it('accepts every backup code once', async () => {
    const app = await start();
    const cookie = await setUpAdmin(app);
    const { backupCodes } = await enableTwoFactor(app, cookie);
    const code = backupCodes[0] ?? '';

    const { response } = await loginWithCode(app, code.toUpperCase().replace('-', ' '));
    expect(response.json()).toEqual({ status: 'active' });
    expect((await get(app, '/api/v1/me', sessionCookie(response))).json()).toMatchObject({
      backupCodesLeft: 9,
    });

    const reused = await loginWithCode(app, code);
    expect(reused.response.json()).toMatchObject({ error: { code: 'invalid_code' } });
  });

  it('ends the pending login after too many wrong codes', async () => {
    const app = await start();
    const cookie = await setUpAdmin(app);
    const { secret } = await enableTwoFactor(app, cookie);
    const first = await login(app);
    const pending = sessionCookie(first);
    const attempt = (code: string) =>
      send(app, 'POST', '/api/v1/auth/login/2fa', { cookie: pending, body: { code } });

    for (let i = 0; i < 4; i += 1) expect((await attempt('999999')).statusCode).toBe(400);
    const blocked = await attempt('999999');
    expect(blocked.statusCode).toBe(401);
    expect(blocked.json()).toMatchObject({ error: { code: 'too_many_attempts' } });
    expect((await attempt(totpAt(secret, Date.now() + 30_000))).statusCode).toBe(401);
  });
});

describe('protection', () => {
  it('throttles wrong passwords per username', async () => {
    const app = await start(without2faRequirement);
    await setUpAdmin(app);
    for (let i = 0; i < 5; i += 1)
      expect((await login(app, 'wrong password')).statusCode).toBe(401);
    const blocked = await login(app);
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('rejects state-changing requests without the CSRF header or from another origin', async () => {
    const app = await start();
    const body = { username: 'admin', password: TEST_PASSWORD };
    const noHeader = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: body });
    expect(noHeader.json()).toMatchObject({ error: { code: 'csrf_header_missing' } });

    const foreign = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: body,
      headers: { 'x-outpost-request': '1', origin: 'https://evil.example' },
    });
    expect(foreign.json()).toMatchObject({ error: { code: 'origin_not_allowed' } });

    const sameOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: body,
      headers: { 'x-outpost-request': '1', origin: 'http://localhost:3000' },
    });
    expect(sameOrigin.json()).toMatchObject({ error: { code: 'invalid_credentials' } });
  });

  it('sets a hardened session cookie', async () => {
    const app = await start();
    const response = await send(app, 'POST', '/api/v1/setup', {
      body: { token: TEST_SETUP_TOKEN, username: 'admin', password: TEST_PASSWORD },
    });
    const cookie = response.cookies.find((candidate) => candidate.name === 'outpost_session');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
  });
});

describe('sudo mode', () => {
  it('requires a recent password confirmation for sensitive actions', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    const app = await start();
    const cookie = await setUpAdmin(app);
    await enableTwoFactor(app, cookie);
    const regenerate = () => send(app, 'POST', '/api/v1/me/2fa/backup-codes', { cookie });
    expect((await regenerate()).statusCode).toBe(200);

    vi.setSystemTime(new Date('2030-01-01T00:11:00Z'));
    expect((await regenerate()).json()).toMatchObject({ error: { code: 'sudo_required' } });

    const wrong = await send(app, 'POST', '/api/v1/auth/sudo', {
      cookie,
      body: { password: 'nope' },
    });
    expect(wrong.json()).toMatchObject({ error: { code: 'invalid_password' } });
    const sudo = await send(app, 'POST', '/api/v1/auth/sudo', {
      cookie,
      body: { password: TEST_PASSWORD },
    });
    expect(sudo.json()).toEqual({ sudoUntil: '2030-01-01T00:21:00.000Z' });
    expect((await regenerate()).json()).toMatchObject({ backupCodes: expect.any(Array) });
  });
});

describe('password and sessions', () => {
  it('signs out other sessions when the password changes', async () => {
    const app = await start(without2faRequirement);
    const first = await setUpAdmin(app);
    const second = sessionCookie(await login(app));

    const wrong = await send(app, 'POST', '/api/v1/me/password', {
      cookie: first,
      body: { currentPassword: 'nope', newPassword: 'a brand new passphrase' },
    });
    expect(wrong.json()).toMatchObject({ error: { code: 'invalid_password' } });

    const changed = await send(app, 'POST', '/api/v1/me/password', {
      cookie: first,
      body: { currentPassword: TEST_PASSWORD, newPassword: 'a brand new passphrase' },
    });
    expect(changed.statusCode).toBe(204);
    expect((await get(app, '/api/v1/me', second)).statusCode).toBe(401);
    expect((await get(app, '/api/v1/me', first)).statusCode).toBe(200);
    expect((await login(app)).statusCode).toBe(401);
    expect((await login(app, 'a brand new passphrase')).statusCode).toBe(200);
  });

  it('lists and revokes sessions', async () => {
    const app = await start(without2faRequirement);
    const first = await setUpAdmin(app);
    const second = sessionCookie(await login(app));

    const list = (await get(app, '/api/v1/me/sessions', first)).json<{
      sessions: { id: string; current: boolean }[];
    }>();
    expect(list.sessions).toHaveLength(2);
    const other = list.sessions.find((session) => !session.current);
    expect(other).toBeDefined();

    expect(
      (await send(app, 'DELETE', `/api/v1/me/sessions/${other?.id}`, { cookie: first })).statusCode,
    ).toBe(204);
    expect((await get(app, '/api/v1/me', second)).statusCode).toBe(401);
    expect(
      (await send(app, 'DELETE', '/api/v1/me/sessions/unknown', { cookie: first })).statusCode,
    ).toBe(404);

    const third = sessionCookie(await login(app));
    expect((await send(app, 'DELETE', '/api/v1/me/sessions', { cookie: first })).statusCode).toBe(
      204,
    );
    expect((await get(app, '/api/v1/me', third)).statusCode).toBe(401);
    expect((await get(app, '/api/v1/me', first)).statusCode).toBe(200);
  });

  it('expires sessions after a week without activity', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    const app = await start(without2faRequirement);
    const cookie = await setUpAdmin(app);
    vi.setSystemTime(new Date('2030-01-07T23:00:00Z'));
    expect((await get(app, '/api/v1/me', cookie)).statusCode).toBe(200);
    vi.setSystemTime(new Date('2030-01-15T00:00:00Z'));
    expect((await get(app, '/api/v1/me', cookie)).statusCode).toBe(401);
  });
});

describe('disabling two-factor authentication', () => {
  it('is not allowed for administrators while it is required', async () => {
    const app = await start();
    const cookie = await setUpAdmin(app);
    const { backupCodes } = await enableTwoFactor(app, cookie);
    const response = await send(app, 'POST', '/api/v1/me/2fa/disable', {
      cookie,
      body: { code: backupCodes[0] },
    });
    expect(response.json()).toMatchObject({ error: { code: 'two_factor_required' } });
  });

  it('needs a valid code', async () => {
    const app = await start(without2faRequirement);
    const cookie = await setUpAdmin(app);
    const { backupCodes } = await enableTwoFactor(app, cookie);
    const disable = (code: string) =>
      send(app, 'POST', '/api/v1/me/2fa/disable', { cookie, body: { code } });
    expect((await disable('999999')).json()).toMatchObject({ error: { code: 'invalid_code' } });
    expect((await disable(backupCodes[1] ?? '')).statusCode).toBe(204);
    expect((await get(app, '/api/v1/me', cookie)).json()).toMatchObject({
      twoFactorEnabled: false,
      backupCodesLeft: 0,
    });
  });
});

describe('audit log', () => {
  it('records authentication events', async () => {
    const app = await start(without2faRequirement);
    const cookie = await setUpAdmin(app);
    await login(app, 'wrong password');
    await login(app);
    await send(app, 'POST', '/api/v1/auth/logout', { cookie });
    const actions = (await get(app, '/api/v1/plugins/test.audit/actions')).json<string[]>();
    expect(actions).toEqual(
      expect.arrayContaining(['auth.setup', 'auth.login_failed', 'auth.login', 'auth.logout']),
    );
  });
});
