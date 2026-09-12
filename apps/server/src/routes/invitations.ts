import { HttpError } from '@outpost/plugin-api';
import {
  API_PREFIX,
  invitationAcceptSchema,
  invitationCreatedSchema,
  invitationCreateSchema,
  invitationListSchema,
  invitationPreviewSchema,
  invitationTokenSchema,
  loginResultSchema,
} from '@outpost/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  acceptInvitation,
  createInvitation,
  deleteInvitation,
  findPendingInvitation,
  InvitationError,
  listInvitations,
  toInvitationInfo,
} from '../auth/invitations.js';
import { hashPassword, passwordProblem } from '../auth/password.js';
import type { AuthService } from '../auth/service.js';

const DAY_MS = 24 * 60 * 60_000;

/** Invitation links: managed by superadmins, opened and accepted by the invited person. */
export function registerInvitationRoutes(fastify: FastifyInstance, auth: AuthService): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tokenParams = z.object({ token: invitationTokenSchema });
  const invalid = () =>
    new HttpError(404, 'invitation_invalid', new InvitationError('invitation_invalid').message);

  // Public: the invited person opens the link.
  app.get(
    `${API_PREFIX}/invite/:token`,
    { schema: { tags: ['auth'], params: tokenParams, response: { 200: invitationPreviewSchema } } },
    async (request) => {
      const invitation = await findPendingInvitation(auth.db, request.params.token);
      if (invitation === undefined) throw invalid();
      return {
        isSuperadmin: invitation.is_superadmin === 1,
        invitedBy: invitation.created_by_username,
        expiresAt: new Date(invitation.expires_at).toISOString(),
      };
    },
  );

  app.post(
    `${API_PREFIX}/invite/:token/accept`,
    {
      schema: {
        tags: ['auth'],
        params: tokenParams,
        body: invitationAcceptSchema,
        response: { 201: loginResultSchema },
      },
    },
    async (request, reply) => {
      const { username, password } = request.body;
      const problem = passwordProblem(password, username);
      if (problem) throw new HttpError(400, problem, 'The password must not contain the username');
      // Checked before the costly password hashing, so invalid links cannot keep the CPU busy.
      if ((await findPendingInvitation(auth.db, request.params.token)) === undefined) {
        throw invalid();
      }
      let accepted;
      try {
        accepted = await acceptInvitation(auth.db, {
          token: request.params.token,
          username,
          passwordHash: await hashPassword(password),
        });
      } catch (err) {
        if (!(err instanceof InvitationError)) throw err;
        throw err.code === 'username_taken'
          ? new HttpError(409, err.code, err.message)
          : new HttpError(404, err.code, err.message);
      }
      const { user, invitation } = accepted;
      await auth.audit.record({
        action: 'auth.invitation_accepted',
        userId: user.id,
        target: invitation.id,
        ip: request.ip,
      });
      const status = await auth.signIn(request, reply, user, { method: 'invitation' });
      return reply.code(201).send({ status });
    },
  );

  const tags = ['admin'];
  const base = `${API_PREFIX}/invitations`;

  app.get(base, { schema: { tags, response: { 200: invitationListSchema } } }, async (request) => {
    auth.requireSuperadmin(request);
    return { invitations: await listInvitations(auth.db) };
  });

  app.post(
    base,
    { schema: { tags, body: invitationCreateSchema, response: { 201: invitationCreatedSchema } } },
    async (request, reply) => {
      const { user } = auth.requireSuperadmin(request, { sudo: true });
      const { isSuperadmin, expiresInDays, note } = request.body;
      const { token, invitation } = await createInvitation(auth.db, {
        createdBy: user.id,
        isSuperadmin,
        note: note || null,
        lifetimeMs: expiresInDays * DAY_MS,
      });
      await auth.audit.record({
        action: 'admin.invitation_created',
        userId: user.id,
        target: invitation.id,
        ip: request.ip,
        details: { isSuperadmin, expiresInDays },
      });
      return reply.code(201).send({
        invitation: toInvitationInfo(invitation, user.username, null),
        url: `${auth.config.publicUrl}/invite/${token}`,
      });
    },
  );

  app.delete(
    `${base}/:id`,
    { schema: { tags, params: z.object({ id: z.string() }) } },
    async (request, reply) => {
      const { user } = auth.requireSuperadmin(request);
      if (!(await deleteInvitation(auth.db, request.params.id))) {
        throw new HttpError(404, 'not_found', 'No such invitation');
      }
      await auth.audit.record({
        action: 'admin.invitation_deleted',
        userId: user.id,
        target: request.params.id,
        ip: request.ip,
      });
      return reply.code(204).send();
    },
  );
}
