import { HttpError } from '@outpost/plugin-api';
import {
  API_PREFIX,
  backupCodesSchema,
  currentUserSchema,
  identityListSchema,
  passwordChangeRequestSchema,
  sessionListSchema,
  themeRequestSchema,
  twoFactorSetupSchema,
  verificationRequestSchema,
} from '@outpost/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { generateBackupCodes, hashBackupCode } from '../auth/backup-codes.js';
import { listIdentities, unlinkIdentity } from '../auth/identities.js';
import { hashPassword, passwordProblem, verifyPassword } from '../auth/password.js';
import type { AuthService } from '../auth/service.js';
import { generateTotpSecret, totpUri, verifyTotp } from '../auth/totp.js';
import { deleteBackupCodes, replaceBackupCodes, toCurrentUser, updateUser } from '../auth/users.js';

/**
 * The signed-in user's own account: password, two-factor authentication, sessions and linked
 * login providers.
 */
export function registerMeRoutes(fastify: FastifyInstance, auth: AuthService): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['account'];
  const base = `${API_PREFIX}/me`;

  const newBackupCodes = async (userId: string): Promise<string[]> => {
    const codes = generateBackupCodes();
    await replaceBackupCodes(auth.db, userId, codes.map(hashBackupCode));
    return codes;
  };

  app.get(base, { schema: { tags, response: { 200: currentUserSchema } } }, async (request) => {
    const { user } = auth.requireUser(request, { allowEnrollment: true });
    return toCurrentUser(auth.db, user);
  });

  // A display preference, so neither sudo mode nor an audit entry.
  app.put(
    `${base}/theme`,
    { schema: { tags, body: themeRequestSchema } },
    async (request, reply) => {
      const { user } = auth.requireUser(request, { allowEnrollment: true });
      await updateUser(auth.db, user.id, { theme: request.body.theme });
      return reply.code(204).send();
    },
  );

  app.post(
    `${base}/password`,
    { schema: { tags, body: passwordChangeRequestSchema } },
    async (request, reply) => {
      const ctx = auth.requireUser(request, { allowEnrollment: true });
      const { user, session } = ctx;
      const { currentPassword, newPassword } = request.body;
      const firstPassword = user.password_hash === null;
      if (firstPassword) {
        // Accounts created through a provider confirm their identity with sudo mode instead.
        auth.assertSudo(ctx);
      } else {
        const key = `user:${user.username}`;
        auth.assertNotBlocked(reply, [auth.passwordFailures, key]);
        if (!(await verifyPassword(user.password_hash, currentPassword ?? ''))) {
          auth.passwordFailures.recordFailure(key);
          throw new HttpError(403, 'invalid_password', 'The current password is wrong');
        }
        auth.passwordFailures.reset(key);
      }
      const problem = passwordProblem(newPassword, user.username);
      if (problem) throw new HttpError(400, problem, 'The password must not contain the username');

      await updateUser(auth.db, user.id, { password_hash: await hashPassword(newPassword) });
      // Whoever knew the old password is signed out everywhere else.
      if (!firstPassword) await auth.sessions.deleteForUser(user.id, session.id);
      await auth.audit.record({
        action: firstPassword ? 'auth.password_set' : 'auth.password_changed',
        userId: user.id,
        ip: request.ip,
      });
      return reply.code(204).send();
    },
  );

  app.get(
    `${base}/identities`,
    { schema: { tags, response: { 200: identityListSchema } } },
    async (request) => {
      const { user } = auth.requireUser(request, { allowEnrollment: true });
      const identities = await listIdentities(auth.db, user.id);
      return {
        identities: identities.map((identity) => ({
          provider: identity.provider,
          // A provider that was removed from the configuration still shows up under its id.
          providerName: auth.providers.get(identity.provider)?.name ?? identity.provider,
          displayName: identity.display_name,
          createdAt: new Date(identity.created_at).toISOString(),
          lastUsedAt:
            identity.last_used_at === null ? null : new Date(identity.last_used_at).toISOString(),
        })),
      };
    },
  );

  app.delete(
    `${base}/identities/:provider`,
    { schema: { tags, params: z.object({ provider: z.string() }) } },
    async (request, reply) => {
      const { user } = auth.requireUser(request, { allowEnrollment: true, sudo: true });
      const identities = await listIdentities(auth.db, user.id);
      if (!identities.some((identity) => identity.provider === request.params.provider)) {
        throw new HttpError(404, 'not_found', 'This provider is not linked');
      }
      if (user.password_hash === null && identities.length === 1) {
        throw new HttpError(
          409,
          'last_login_method',
          'Set a password or link another provider before unlinking this one',
        );
      }
      await unlinkIdentity(auth.db, user.id, request.params.provider);
      await auth.audit.record({
        action: 'auth.identity_unlinked',
        userId: user.id,
        ip: request.ip,
        details: { provider: request.params.provider },
      });
      return reply.code(204).send();
    },
  );

  app.post(
    `${base}/2fa/setup`,
    { schema: { tags, response: { 200: twoFactorSetupSchema } } },
    async (request) => {
      const { user } = auth.requireUser(request, { allowEnrollment: true, sudo: true });
      if (user.totp_enabled_at !== null) {
        throw new HttpError(409, 'two_factor_enabled', 'Two-factor authentication is already on');
      }
      const secret = generateTotpSecret();
      await updateUser(auth.db, user.id, { totp_pending_secret: auth.totpSecrets.seal(secret) });
      return { secret, uri: totpUri(secret, user.username) };
    },
  );

  app.post(
    `${base}/2fa/enable`,
    { schema: { tags, body: verificationRequestSchema, response: { 200: backupCodesSchema } } },
    async (request) => {
      const { user } = auth.requireUser(request, { allowEnrollment: true, sudo: true });
      if (user.totp_enabled_at !== null) {
        throw new HttpError(409, 'two_factor_enabled', 'Two-factor authentication is already on');
      }
      if (user.totp_pending_secret === null) {
        throw new HttpError(409, 'two_factor_setup_missing', 'Start the setup first');
      }
      const secret = auth.totpSecrets.open(user.totp_pending_secret);
      const step = verifyTotp(secret, request.body.code.replace(/\s/g, ''), Date.now(), null);
      if (step === null) throw new HttpError(400, 'invalid_code', 'The code is not valid');

      await updateUser(auth.db, user.id, {
        totp_secret: user.totp_pending_secret,
        totp_pending_secret: null,
        totp_last_step: step,
        totp_enabled_at: Date.now(),
      });
      const backupCodes = await newBackupCodes(user.id);
      await auth.audit.record({
        action: 'auth.two_factor_enabled',
        userId: user.id,
        ip: request.ip,
      });
      return { backupCodes };
    },
  );

  app.post(
    `${base}/2fa/disable`,
    { schema: { tags, body: verificationRequestSchema } },
    async (request, reply) => {
      const { user } = auth.requireUser(request, { sudo: true });
      if (user.totp_enabled_at === null) {
        throw new HttpError(409, 'two_factor_disabled', 'Two-factor authentication is already off');
      }
      if (auth.config.requireTwoFactorForAdmins && user.is_superadmin === 1) {
        throw new HttpError(
          409,
          'two_factor_required',
          'Administrators must keep two-factor authentication on',
        );
      }
      if ((await auth.verifySecondFactor(user, request.body.code)) === null) {
        throw new HttpError(400, 'invalid_code', 'The code is not valid');
      }
      await updateUser(auth.db, user.id, {
        totp_secret: null,
        totp_pending_secret: null,
        totp_last_step: null,
        totp_enabled_at: null,
      });
      await deleteBackupCodes(auth.db, user.id);
      await auth.audit.record({
        action: 'auth.two_factor_disabled',
        userId: user.id,
        ip: request.ip,
      });
      return reply.code(204).send();
    },
  );

  app.post(
    `${base}/2fa/backup-codes`,
    { schema: { tags, response: { 200: backupCodesSchema } } },
    async (request) => {
      const { user } = auth.requireUser(request, { sudo: true });
      if (user.totp_enabled_at === null) {
        throw new HttpError(409, 'two_factor_disabled', 'Two-factor authentication is off');
      }
      const backupCodes = await newBackupCodes(user.id);
      await auth.audit.record({
        action: 'auth.backup_codes_regenerated',
        userId: user.id,
        ip: request.ip,
      });
      return { backupCodes };
    },
  );

  app.get(
    `${base}/sessions`,
    { schema: { tags, response: { 200: sessionListSchema } } },
    async (request) => {
      const { user, session: current } = auth.requireUser(request, { allowEnrollment: true });
      const sessions = await auth.sessions.listActive(user.id);
      return {
        sessions: sessions.map((session) => ({
          id: session.id,
          current: session.id === current.id,
          createdAt: new Date(session.created_at).toISOString(),
          lastSeenAt: new Date(session.last_seen_at).toISOString(),
          ip: session.ip,
          userAgent: session.user_agent,
        })),
      };
    },
  );

  app.delete(
    `${base}/sessions/:id`,
    { schema: { tags, params: z.object({ id: z.string() }) } },
    async (request, reply) => {
      const { user, session } = auth.requireUser(request, { allowEnrollment: true });
      if (!(await auth.sessions.deleteOwned(user.id, request.params.id))) {
        throw new HttpError(404, 'not_found', 'No such session');
      }
      if (request.params.id === session.id) auth.clearSessionCookie(reply);
      await auth.audit.record({
        action: 'auth.session_revoked',
        userId: user.id,
        target: request.params.id,
        ip: request.ip,
      });
      return reply.code(204).send();
    },
  );

  app.delete(`${base}/sessions`, { schema: { tags } }, async (request, reply) => {
    const { user, session } = auth.requireUser(request, { allowEnrollment: true });
    await auth.sessions.deleteForUser(user.id, session.id);
    await auth.audit.record({
      action: 'auth.other_sessions_revoked',
      userId: user.id,
      ip: request.ip,
    });
    return reply.code(204).send();
  });
}
