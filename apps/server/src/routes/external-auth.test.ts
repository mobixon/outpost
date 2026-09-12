import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { Events, OAuth2Server } from 'oauth2-mock-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GithubEndpoints } from '../auth/providers.js';
import { totpAt } from '../auth/totp.js';
import { get, send, sessionCookie, setUpAdmin, startTestApp } from '../test-helpers.js';

// A real OpenID Connect provider for tests: discovery, signed ID tokens, PKCE and nonce.
let idp: OAuth2Server;
/** Claims of the tokens the provider issues next; each test starts with Ann's. */
let claims: Record<string, unknown>;

beforeAll(async () => {
  idp = new OAuth2Server();
  await idp.issuer.keys.generate('RS256');
  // An IPv4 address: "localhost" may resolve differently for the server and for fetch().
  await idp.start(0, '127.0.0.1');
  idp.service.on(Events.BeforeTokenSigning, (token) => {
    Object.assign(token.payload, claims);
  });
});

afterAll(async () => {
  await idp.stop();
});

beforeEach(() => {
  claims = {
    sub: 'idp-ann',
    preferred_username: 'Ann.Smith',
    email: 'ann@example.com',
    email_verified: true,
  };
});

let app: FastifyInstance | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await app?.close();
  app = undefined;
});

const oidcEnv = (extra: Record<string, string> = {}) => ({
  OUTPOST_REQUIRE_2FA_FOR_ADMINS: 'false',
  OUTPOST_OIDC_IDP_ISSUER: idp.issuer.url ?? '',
  OUTPOST_OIDC_IDP_CLIENT_ID: 'outpost',
  OUTPOST_OIDC_IDP_CLIENT_SECRET: 'client-secret',
  OUTPOST_OIDC_IDP_NAME: 'Test IdP',
  ...extra,
});

const start = async (env: Record<string, string>, githubEndpoints?: GithubEndpoints) => {
  app = await startTestApp({ env, ...(githubEndpoints && { githubEndpoints }) });
  return app;
};

/** The fake OIDC provider signs the user in at once and redirects back. */
async function approveAtIdp(url: URL): Promise<URL> {
  const response = await fetch(url, { redirect: 'manual' });
  return new URL(response.headers.get('location') ?? '');
}

/**
 * Starts a login at a provider as the web UI does, lets the provider approve it and delivers the
 * callback with the browser's cookies. Returns the callback response.
 */
async function roundTrip(
  server: FastifyInstance,
  provider: string,
  body: object,
  cookie?: string,
  approve: (url: URL) => Promise<URL> = approveAtIdp,
): Promise<LightMyRequestResponse> {
  const started = await send(server, 'POST', `/api/v1/auth/providers/${provider}/start`, {
    body,
    ...(cookie && { cookie }),
  });
  expect(started.statusCode, started.body).toBe(200);
  const flow = started.cookies.find((candidate) => candidate.name === 'outpost_auth_flow');
  const callback = await approve(new URL(started.json<{ url: string }>().url));
  return server.inject({
    method: 'GET',
    url: `${callback.pathname}${callback.search}`,
    headers: {
      cookie: [cookie, flow && `outpost_auth_flow=${flow.value}`].filter(Boolean).join('; '),
    },
  });
}

/** Where the callback sends the browser. */
function returnPath(response: LightMyRequestResponse): string {
  expect(response.statusCode, response.body).toBe(302);
  return String(response.headers.location);
}

async function enableTwoFactor(server: FastifyInstance, cookie: string): Promise<string> {
  const { secret } = (await send(server, 'POST', '/api/v1/me/2fa/setup', { cookie })).json<{
    secret: string;
  }>();
  const enabled = await send(server, 'POST', '/api/v1/me/2fa/enable', {
    cookie,
    body: { code: totpAt(secret, Date.now()) },
  });
  expect(enabled.statusCode).toBe(200);
  return secret;
}

describe('OpenID Connect login', () => {
  it('links the provider from the account and signs in with it', async () => {
    const server = await start(oidcEnv());
    const admin = await setUpAdmin(server);
    expect((await get(server, '/api/v1/auth/session')).json()).toMatchObject({
      providers: [{ id: 'idp', name: 'Test IdP' }],
    });

    const linked = await roundTrip(server, 'idp', { intent: 'link' }, admin);
    expect(returnPath(linked)).toBe('/auth/return?intent=link');
    expect((await get(server, '/api/v1/me/identities', admin)).json()).toMatchObject({
      identities: [{ provider: 'idp', providerName: 'Test IdP', displayName: 'Ann.Smith' }],
    });

    const login = await roundTrip(server, 'idp', { intent: 'login' });
    expect(returnPath(login)).toBe('/auth/return?intent=login');
    expect((await get(server, '/api/v1/auth/session', sessionCookie(login))).json()).toMatchObject({
      status: 'active',
      user: { username: 'admin' },
    });
  });

  it('creates accounts only when the signup rules allow it', async () => {
    const closed = await start(oidcEnv());
    await setUpAdmin(closed);
    const denied = await roundTrip(closed, 'idp', { intent: 'login' });
    expect(returnPath(denied)).toBe('/auth/return?intent=login&error=not_linked');
    expect(denied.cookies.some((cookie) => cookie.name === 'outpost_session')).toBe(false);
    await closed.close();

    const open = await start(oidcEnv({ OUTPOST_OIDC_IDP_SIGNUP_DOMAINS: 'example.com' }));
    await setUpAdmin(open);
    const login = await roundTrip(open, 'idp', { intent: 'login' });
    expect(returnPath(login)).toBe('/auth/return?intent=login');
    expect((await get(open, '/api/v1/me', sessionCookie(login))).json()).toMatchObject({
      username: 'ann.smith',
      isSuperadmin: false,
      hasPassword: false,
    });

    // An email address the provider has not verified does not count.
    claims = { sub: 'idp-eve', email: 'eve@example.com', email_verified: false };
    expect(returnPath(await roundTrip(open, 'idp', { intent: 'login' }))).toContain(
      'error=not_linked',
    );
  });

  it('still asks for the Outpost code unless a trusted provider reports a multi-factor login', async () => {
    const server = await start(oidcEnv());
    const admin = await setUpAdmin(server);
    await enableTwoFactor(server, admin);
    await roundTrip(server, 'idp', { intent: 'link' }, admin);

    claims['amr'] = ['pwd', 'mfa'];
    const login = await roundTrip(server, 'idp', { intent: 'login' });
    expect((await get(server, '/api/v1/auth/session', sessionCookie(login))).json()).toMatchObject({
      status: 'mfa',
    });
  });

  it('lets a trusted multi-factor login replace the required enrollment', async () => {
    const server = await start(
      oidcEnv({ OUTPOST_REQUIRE_2FA_FOR_ADMINS: 'true', OUTPOST_OIDC_IDP_TRUST_MFA: 'true' }),
    );
    const admin = await setUpAdmin(server);
    await roundTrip(server, 'idp', { intent: 'link' }, admin);

    claims['amr'] = ['pwd', 'mfa'];
    const strong = await roundTrip(server, 'idp', { intent: 'login' });
    expect((await get(server, '/api/v1/auth/session', sessionCookie(strong))).json()).toMatchObject(
      { status: 'active', twoFactorEnrollmentRequired: false },
    );

    claims['amr'] = ['pwd'];
    const weak = await roundTrip(server, 'idp', { intent: 'login' });
    expect((await get(server, '/api/v1/auth/session', sessionCookie(weak))).json()).toMatchObject({
      status: 'active',
      twoFactorEnrollmentRequired: true,
    });
  });

  it('rejects callbacks that do not belong to the browser', async () => {
    const server = await start(oidcEnv());
    await setUpAdmin(server);
    const startLogin = () =>
      send(server, 'POST', '/api/v1/auth/providers/idp/start', { body: { intent: 'login' } });

    const first = await startLogin();
    const callback = await approveAtIdp(new URL(first.json<{ url: string }>().url));
    const withoutFlow = await server.inject({
      method: 'GET',
      url: `${callback.pathname}${callback.search}`,
    });
    expect(returnPath(withoutFlow)).toBe('/auth/return?intent=login&error=flow_expired');

    // The flow cookie of another login attempt has another state.
    const second = await startLogin();
    const flow = second.cookies.find((cookie) => cookie.name === 'outpost_auth_flow');
    const mixed = await server.inject({
      method: 'GET',
      url: `${callback.pathname}${callback.search}`,
      headers: { cookie: `outpost_auth_flow=${flow?.value}` },
    });
    expect(returnPath(mixed)).toBe('/auth/return?intent=login&error=provider_error');
  });

  it('reports a login cancelled at the provider', async () => {
    const server = await start(oidcEnv());
    await setUpAdmin(server);
    idp.service.once(Events.BeforeAuthorizeRedirect, ({ url }) => {
      url.searchParams.delete('code');
      url.searchParams.set('error', 'access_denied');
    });
    const response = await roundTrip(server, 'idp', { intent: 'login' });
    expect(returnPath(response)).toBe('/auth/return?intent=login&error=access_denied');
  });

  it('confirms sudo mode for accounts without a password by signing in again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const server = await start(oidcEnv({ OUTPOST_OIDC_IDP_SIGNUP_EMAILS: 'ann@example.com' }));
    const admin = await setUpAdmin(server);
    const ann = sessionCookie(await roundTrip(server, 'idp', { intent: 'login' }));

    // Accounts with a password confirm it instead.
    const adminSudo = await send(server, 'POST', '/api/v1/auth/providers/idp/start', {
      cookie: admin,
      body: { intent: 'sudo' },
    });
    expect(adminSudo.json()).toMatchObject({ error: { code: 'password_required' } });

    vi.setSystemTime(Date.now() + 11 * 60_000);
    const setup = () => send(server, 'POST', '/api/v1/me/2fa/setup', { cookie: ann });
    expect((await setup()).json()).toMatchObject({ error: { code: 'sudo_required' } });

    // Someone else's account at the provider does not confirm Ann's session.
    claims = { sub: 'idp-bob' };
    expect(returnPath(await roundTrip(server, 'idp', { intent: 'sudo' }, ann))).toBe(
      '/auth/return?intent=sudo&error=reauthentication_failed',
    );
    claims = { sub: 'idp-ann' };
    expect(returnPath(await roundTrip(server, 'idp', { intent: 'sudo' }, ann))).toBe(
      '/auth/return?intent=sudo',
    );
    expect((await setup()).statusCode).toBe(200);
  });

  it('confirms sudo mode with a code for accounts without a password that use 2FA', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const server = await start(oidcEnv({ OUTPOST_OIDC_IDP_SIGNUP_EMAILS: 'ann@example.com' }));
    await setUpAdmin(server);
    const ann = sessionCookie(await roundTrip(server, 'idp', { intent: 'login' }));
    const secret = await enableTwoFactor(server, ann);

    vi.setSystemTime(Date.now() + 11 * 60_000);
    const sudo = await send(server, 'POST', '/api/v1/auth/sudo', {
      cookie: ann,
      body: { code: totpAt(secret, Date.now()) },
    });
    expect(sudo.statusCode).toBe(200);
  });

  it('creates the account of an invitation with the provider as login method', async () => {
    const server = await start(oidcEnv());
    const admin = await setUpAdmin(server);
    const invite = async () => {
      const created = await send(server, 'POST', '/api/v1/invitations', {
        cookie: admin,
        body: { isSuperadmin: false, expiresInDays: 7 },
      });
      return new URL(created.json<{ url: string }>().url).pathname.split('/').pop() ?? '';
    };

    const token = await invite();
    const accepted = await roundTrip(server, 'idp', { intent: 'invite', token, username: 'ann' });
    expect(returnPath(accepted)).toBe('/auth/return?intent=invite');
    expect((await get(server, '/api/v1/me', sessionCookie(accepted))).json()).toMatchObject({
      username: 'ann',
      hasPassword: false,
    });

    // The invitation is used up.
    const again = await send(server, 'POST', '/api/v1/auth/providers/idp/start', {
      body: { intent: 'invite', token, username: 'ann2' },
    });
    expect(again.json()).toMatchObject({ error: { code: 'invitation_invalid' } });

    // One account per identity: Ann cannot accept a second invitation with the same login.
    const second = await roundTrip(server, 'idp', {
      intent: 'invite',
      token: await invite(),
      username: 'ann2',
    });
    expect(returnPath(second)).toBe('/auth/return?intent=invite&error=identity_in_use');
  });

  it('keeps at least one login method when unlinking', async () => {
    const server = await start(oidcEnv({ OUTPOST_OIDC_IDP_SIGNUP_EMAILS: 'ann@example.com' }));
    await setUpAdmin(server);
    const ann = sessionCookie(await roundTrip(server, 'idp', { intent: 'login' }));
    const unlink = () => send(server, 'DELETE', '/api/v1/me/identities/idp', { cookie: ann });

    expect((await unlink()).json()).toMatchObject({ error: { code: 'last_login_method' } });
    const password = await send(server, 'POST', '/api/v1/me/password', {
      cookie: ann,
      body: { newPassword: 'a first password for ann' },
    });
    expect(password.statusCode).toBe(204);
    expect((await unlink()).statusCode).toBe(204);
    expect((await get(server, '/api/v1/me/identities', ann)).json()).toEqual({ identities: [] });
  });
});

describe('GitHub login', () => {
  // A fake of the parts of GitHub that Outpost uses.
  let github: FastifyInstance;
  let endpoints: GithubEndpoints;
  let memberships: Record<string, string>;

  beforeAll(async () => {
    github = Fastify();
    github.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_request, body, done) => {
        done(null, Object.fromEntries(new URLSearchParams(String(body))));
      },
    );
    github.post('/login/oauth/access_token', async (request, reply) => {
      const body = request.body as Record<string, string>;
      if (body['code'] !== 'good-code' || !body['code_verifier'] || !body['client_secret']) {
        return reply.code(400).send({ error: 'bad_verification_code' });
      }
      return { access_token: 'gh-token', token_type: 'bearer', scope: 'user:email,read:org' };
    });
    github.addHook('onRequest', async (request, reply) => {
      if (request.url.startsWith('/user') && request.headers.authorization !== 'Bearer gh-token') {
        return reply.code(401).send({ message: 'Bad credentials' });
      }
    });
    github.get('/user', async () => ({ id: 4242, login: 'Octo-Cat' }));
    github.get('/user/emails', async () => [
      { email: 'Octo@Example.com', verified: true, primary: true },
      { email: 'octo@unverified.example', verified: false, primary: false },
    ]);
    github.get<{ Params: { org: string } }>(
      '/user/memberships/orgs/:org',
      async (request, reply) => {
        const state = memberships[request.params.org];
        return state === undefined ? reply.code(404).send({}) : { state };
      },
    );
    await github.listen({ port: 0, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${(github.server.address() as AddressInfo).port}`;
    endpoints = {
      authorize: `${base}/login/oauth/authorize`,
      token: `${base}/login/oauth/access_token`,
      api: base,
    };
  });

  afterAll(async () => {
    await github.close();
  });

  const githubEnv = (extra: Record<string, string> = {}) => ({
    OUTPOST_REQUIRE_2FA_FOR_ADMINS: 'false',
    OUTPOST_GITHUB_CLIENT_ID: 'gh-client',
    OUTPOST_GITHUB_CLIENT_SECRET: 'gh-secret',
    ...extra,
  });

  /** GitHub approves the login: back to the redirect URI with a code. */
  let authorizeRequest: URL | undefined;
  async function approveAtGithub(url: URL): Promise<URL> {
    authorizeRequest = url;
    const callback = new URL(url.searchParams.get('redirect_uri') ?? '');
    callback.searchParams.set('code', 'good-code');
    callback.searchParams.set('state', url.searchParams.get('state') ?? '');
    return callback;
  }

  it('creates accounts for members of the signup organizations', async () => {
    memberships = { acme: 'active' };
    const server = await start(githubEnv({ OUTPOST_GITHUB_SIGNUP_ORGS: 'acme' }), endpoints);
    await setUpAdmin(server);

    const login = await roundTrip(
      server,
      'github',
      { intent: 'login' },
      undefined,
      approveAtGithub,
    );
    expect(returnPath(login)).toBe('/auth/return?intent=login');
    expect(authorizeRequest?.searchParams.get('scope')).toBe('read:org');
    expect(authorizeRequest?.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizeRequest?.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/v1/auth/providers/github/callback',
    );
    expect((await get(server, '/api/v1/me', sessionCookie(login))).json()).toMatchObject({
      username: 'octo-cat',
    });

    // A pending invitation to the organization is not a membership.
    memberships = { acme: 'pending' };
    await server.close();
    const again = await start(githubEnv({ OUTPOST_GITHUB_SIGNUP_ORGS: 'acme' }), endpoints);
    await setUpAdmin(again);
    const denied = await roundTrip(
      again,
      'github',
      { intent: 'login' },
      undefined,
      approveAtGithub,
    );
    expect(returnPath(denied)).toBe('/auth/return?intent=login&error=not_linked');
  });

  it('creates accounts for verified email domains and signs in linked accounts', async () => {
    memberships = {};
    const server = await start(
      githubEnv({ OUTPOST_GITHUB_SIGNUP_DOMAINS: 'example.com' }),
      endpoints,
    );
    const admin = await setUpAdmin(server);

    const signup = await roundTrip(
      server,
      'github',
      { intent: 'login' },
      undefined,
      approveAtGithub,
    );
    expect(returnPath(signup)).toBe('/auth/return?intent=login');
    expect(authorizeRequest?.searchParams.get('scope')).toBe('user:email');

    // The same GitHub account cannot be linked to a second Outpost account.
    const linked = await roundTrip(server, 'github', { intent: 'link' }, admin, approveAtGithub);
    expect(returnPath(linked)).toBe('/auth/return?intent=link&error=identity_in_use');
  });
});
