import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { get, send, setUpAdmin, startTestApp } from '../test-helpers.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('theme', () => {
  it('is kept in the account and shown with the session', async () => {
    app = await startTestApp({ env: { OUTPOST_REQUIRE_2FA_FOR_ADMINS: 'false' } });
    const outpost = app;
    const cookie = await setUpAdmin(outpost);
    const save = (theme: string, signedIn = true) =>
      send(
        outpost,
        'PUT',
        '/api/v1/me/theme',
        signedIn ? { cookie, body: { theme } } : { body: { theme } },
      );

    expect((await get(outpost, '/api/v1/me', cookie)).json()).toMatchObject({ theme: null });
    expect((await save('dark')).statusCode).toBe(204);
    expect((await get(outpost, '/api/v1/me', cookie)).json()).toMatchObject({ theme: 'dark' });
    expect((await get(outpost, '/api/v1/auth/session', cookie)).json()).toMatchObject({
      user: { theme: 'dark' },
    });

    expect((await save('pink')).statusCode).toBe(400);
    expect((await save('light', false)).statusCode).toBe(401);
  });
});
