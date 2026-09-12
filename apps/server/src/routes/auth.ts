import { HttpError } from '@outpost/plugin-api';
import {
  API_PREFIX,
  loginRequestSchema,
  loginResultSchema,
  sessionStateSchema,
  setupRequestSchema,
  sudoRequestSchema,
  sudoResultSchema,
  verificationRequestSchema,
} from '@outpost/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { hashPassword, passwordProblem, verifyPassword } from '../auth/password.js';
import type { AuthService } from '../auth/service.js';
import { createUser, findUserByUsername } from '../auth/users.js';

export function registerAuthRoutes(fastify: FastifyInstance, auth: AuthService): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['auth'];

  // Public: tells the web UI whether to show setup, login, the second factor or the panel.
  app.get(
    `${API_PREFIX}/auth/session`,
    { schema: { tags, response: { 200: sessionStateSchema } } },
    async (request) => auth.sessionState(request),
  );

  app.post(
    `${API_PREFIX}/setup`,
    { schema: { tags, body: setupRequestSchema, response: { 201: loginResultSchema } } },
    async (request, reply) => {
      const ipKey = `ip:${request.ip}`;
      auth.assertNotBlocked(reply, [auth.ipFailures, ipKey]);
      if (!auth.setup.required)
        throw new HttpError(409, 'already_set_up', 'Outpost is already set up');
      if (!auth.setup.matches(request.body.token)) {
        auth.ipFailures.recordFailure(ipKey);
        throw new HttpError(403, 'invalid_setup_token', 'The setup token is not valid');
      }
      const { username, password } = request.body;
      const problem = passwordProblem(password, username);
      if (problem) throw new HttpError(400, problem, 'The password must not contain the username');

      const passwordHash = await hashPassword(password);
      const user = await auth.setup.run(() =>
        createUser(auth.db, { username, passwordHash, isSuperadmin: true }),
      );
      const { token } = await auth.sessions.create(user.id, 'active', auth.client(request), {
        sudo: true,
      });
      auth.setSessionCookie(reply, token, 'active');
      await auth.audit.record({ action: 'auth.setup', userId: user.id, ip: request.ip });
      return reply.code(201).send({ status: 'active' });
    },
  );

  app.post(
    `${API_PREFIX}/auth/login`,
    { schema: { tags, body: loginRequestSchema, response: { 200: loginResultSchema } } },
    async (request, reply) => {
      const { username, password } = request.body;
      const userKey = `user:${username}`;
      const ipKey = `ip:${request.ip}`;
      auth.assertNotBlocked(reply, [auth.passwordFailures, userKey], [auth.ipFailures, ipKey]);

      const user = await findUserByUsername(auth.db, username);
      const valid = await verifyPassword(user?.password_hash ?? null, password);
      if (user === undefined || !valid || user.disabled_at !== null) {
        auth.passwordFailures.recordFailure(userKey);
        auth.ipFailures.recordFailure(ipKey);
        await auth.audit.record({
          action: 'auth.login_failed',
          userId: user?.id ?? null,
          ip: request.ip,
          details: { username },
        });
        throw new HttpError(401, 'invalid_credentials', 'Wrong username or password');
      }
      auth.passwordFailures.reset(userKey);

      // A new login always gets a new session, never the one the browser brought along.
      if (request.auth !== null) await auth.sessions.delete(request.auth.session.id);
      const status: 'mfa' | 'active' = user.totp_enabled_at !== null ? 'mfa' : 'active';
      const { token } = await auth.sessions.create(user.id, status, auth.client(request), {
        sudo: status === 'active',
      });
      auth.setSessionCookie(reply, token, status);
      if (status === 'active') {
        await auth.audit.record({
          action: 'auth.login',
          userId: user.id,
          ip: request.ip,
          details: { method: 'password' },
        });
      }
      return { status };
    },
  );

  app.post(
    `${API_PREFIX}/auth/login/2fa`,
    { schema: { tags, body: verificationRequestSchema, response: { 200: loginResultSchema } } },
    async (request, reply) => {
      const ctx = request.auth;
      if (ctx === null || ctx.session.status !== 'mfa') {
        throw new HttpError(401, 'unauthenticated', 'Sign in with your password first');
      }
      const key = `mfa:${ctx.session.id}`;
      const method = await auth.verifySecondFactor(ctx.user, request.body.code);
      if (method === null) {
        auth.codeFailures.recordFailure(key);
        await auth.audit.record({
          action: 'auth.login_failed',
          userId: ctx.user.id,
          ip: request.ip,
          details: { reason: 'second_factor' },
        });
        if (auth.codeFailures.blockedFor(key) > 0) {
          await auth.sessions.delete(ctx.session.id);
          auth.clearSessionCookie(reply);
          throw new HttpError(401, 'too_many_attempts', 'Too many wrong codes. Sign in again.');
        }
        throw new HttpError(400, 'invalid_code', 'The code is not valid');
      }
      auth.codeFailures.reset(key);

      await auth.sessions.delete(ctx.session.id);
      const { token } = await auth.sessions.create(ctx.user.id, 'active', auth.client(request), {
        sudo: true,
      });
      auth.setSessionCookie(reply, token, 'active');
      await auth.audit.record({
        action: 'auth.login',
        userId: ctx.user.id,
        ip: request.ip,
        details: { method },
      });
      return { status: 'active' as const };
    },
  );

  app.post(`${API_PREFIX}/auth/logout`, { schema: { tags } }, async (request, reply) => {
    const ctx = request.auth;
    if (ctx !== null) {
      await auth.sessions.delete(ctx.session.id);
      await auth.audit.record({ action: 'auth.logout', userId: ctx.user.id, ip: request.ip });
    }
    auth.clearSessionCookie(reply);
    return reply.code(204).send();
  });

  // Sudo mode: confirming the password unlocks sensitive actions for a few minutes.
  app.post(
    `${API_PREFIX}/auth/sudo`,
    { schema: { tags, body: sudoRequestSchema, response: { 200: sudoResultSchema } } },
    async (request, reply) => {
      const ctx = auth.requireUser(request, { allowEnrollment: true });
      const key = `user:${ctx.user.username}`;
      auth.assertNotBlocked(reply, [auth.passwordFailures, key]);
      if (!(await verifyPassword(ctx.user.password_hash, request.body.password))) {
        auth.passwordFailures.recordFailure(key);
        throw new HttpError(403, 'invalid_password', 'Wrong password');
      }
      auth.passwordFailures.reset(key);
      const until = await auth.sessions.startSudo(ctx.session);
      await auth.audit.record({ action: 'auth.sudo', userId: ctx.user.id, ip: request.ip });
      return { sudoUntil: new Date(until).toISOString() };
    },
  );
}
