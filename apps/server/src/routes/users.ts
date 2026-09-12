import { HttpError } from '@outpost/plugin-api';
import {
  API_PREFIX,
  adminUserListSchema,
  adminUserUpdateSchema,
  type AdminUser,
} from '@outpost/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import { deleteBackupCodes, findUserById, updateUser, type UserRow } from '../auth/users.js';

/** User accounts of the instance, managed by superadmins. */
export function registerUserRoutes(fastify: FastifyInstance, auth: AuthService): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['admin'];
  const base = `${API_PREFIX}/users`;
  const params = z.object({ id: z.string() });

  /** Another user's account; administrators manage their own on the account page. */
  async function target(request: FastifyRequest, id: string): Promise<UserRow> {
    const { user: actor } = auth.requireSuperadmin(request, { sudo: true });
    if (id === actor.id) {
      throw new HttpError(409, 'own_account', 'Change your own account on the account page');
    }
    const user = await findUserById(auth.db, id);
    if (user === undefined) throw new HttpError(404, 'not_found', 'No such user');
    return user;
  }

  app.get(base, { schema: { tags, response: { 200: adminUserListSchema } } }, async (request) => {
    auth.requireSuperadmin(request);
    const [users, identities, activity] = await Promise.all([
      auth.db.selectFrom('users').selectAll().orderBy('username').execute(),
      auth.db.selectFrom('user_identities').select(['user_id', 'provider']).execute(),
      auth.db
        .selectFrom('sessions')
        .select((eb) => ['user_id', eb.fn.max('last_seen_at').as('last_seen_at')])
        .where('status', '=', 'active')
        .groupBy('user_id')
        .execute(),
    ]);
    const lastSeen = new Map(activity.map((row) => [row.user_id, Number(row.last_seen_at)]));
    return {
      users: users.map((user): AdminUser => ({
        id: user.id,
        username: user.username,
        isSuperadmin: user.is_superadmin === 1,
        twoFactorEnabled: user.totp_enabled_at !== null,
        hasPassword: user.password_hash !== null,
        providers: identities
          .filter((identity) => identity.user_id === user.id)
          .map((identity) => identity.provider),
        disabled: user.disabled_at !== null,
        createdAt: new Date(user.created_at).toISOString(),
        lastSeenAt: lastSeen.has(user.id)
          ? new Date(lastSeen.get(user.id) ?? 0).toISOString()
          : null,
      })),
    };
  });

  app.patch(
    `${base}/:id`,
    { schema: { tags, params, body: adminUserUpdateSchema } },
    async (request, reply) => {
      const user = await target(request, request.params.id);
      const { disabled, isSuperadmin } = request.body;
      await updateUser(auth.db, user.id, {
        ...(disabled !== undefined && {
          disabled_at: disabled ? (user.disabled_at ?? Date.now()) : null,
        }),
        ...(isSuperadmin !== undefined && { is_superadmin: isSuperadmin ? 1 : 0 }),
      });
      if (disabled) await auth.sessions.deleteForUser(user.id);
      await auth.audit.record({
        action: 'admin.user_updated',
        userId: request.auth?.user.id ?? null,
        target: user.id,
        ip: request.ip,
        details: { username: user.username, disabled, isSuperadmin },
      });
      return reply.code(204).send();
    },
  );

  // For a lost authenticator: the user signs in with the password alone and sets 2FA up again.
  app.post(`${base}/:id/2fa/reset`, { schema: { tags, params } }, async (request, reply) => {
    const user = await target(request, request.params.id);
    await updateUser(auth.db, user.id, {
      totp_secret: null,
      totp_pending_secret: null,
      totp_last_step: null,
      totp_enabled_at: null,
    });
    await deleteBackupCodes(auth.db, user.id);
    await auth.sessions.deleteForUser(user.id);
    await auth.audit.record({
      action: 'admin.user_two_factor_reset',
      userId: request.auth?.user.id ?? null,
      target: user.id,
      ip: request.ip,
      details: { username: user.username },
    });
    return reply.code(204).send();
  });

  app.delete(`${base}/:id`, { schema: { tags, params } }, async (request, reply) => {
    const user = await target(request, request.params.id);
    // Sessions, backup codes and linked identities go with the account.
    await auth.db.deleteFrom('users').where('id', '=', user.id).execute();
    await auth.audit.record({
      action: 'admin.user_deleted',
      userId: request.auth?.user.id ?? null,
      target: user.id,
      ip: request.ip,
      details: { username: user.username },
    });
    return reply.code(204).send();
  });
}
