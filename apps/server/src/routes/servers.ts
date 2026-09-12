import { HttpError } from '@outpost/plugin-api';
import {
  API_PREFIX,
  auditPageSchema,
  auditQuerySchema,
  CorePermission,
  invitationCreatedSchema,
  invitationListSchema,
  memberAddSchema,
  memberListSchema,
  memberUpdateSchema,
  ROLE_KEYS,
  serverCreateSchema,
  serverInvitationCreateSchema,
  serverListSchema,
  serverSummarySchema,
  serverUpdateSchema,
} from '@outpost/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createInvitation,
  deleteInvitation,
  findInvitation,
  listInvitations,
  toInvitationInfo,
} from '../auth/invitations.js';
import type { AuthService } from '../auth/service.js';
import { findUserByUsername } from '../auth/users.js';
import { canManageRole } from '../rbac/permissions.js';
import type { ServerService } from '../servers/service.js';
import { DAY_MS, invitationUrl } from './invitations.js';

/** Game servers, their members, invitations and audit log. */
export function registerServerRoutes(
  fastify: FastifyInstance,
  auth: AuthService,
  servers: ServerService,
): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['servers'];
  const base = `${API_PREFIX}/servers`;
  const serverParams = z.object({ serverId: z.string() });
  const memberParams = serverParams.extend({ userId: z.string() });
  const invitationParams = serverParams.extend({ invitationId: z.string() });

  const assertSlugFree = async (slug: string, exceptId?: string) => {
    if (await servers.slugTaken(slug, exceptId)) {
      throw new HttpError(409, 'slug_taken', 'Another server already uses this short name');
    }
  };
  const roleNotAllowed = () =>
    new HttpError(403, 'role_not_allowed', 'You cannot manage members with this role');

  app.get(base, { schema: { tags, response: { 200: serverListSchema } } }, async (request) => {
    const { user } = auth.requireUser(request);
    const accessible = await servers.accessible(user);
    return { servers: accessible.map((access) => servers.summary(access)) };
  });

  app.post(
    base,
    { schema: { tags, body: serverCreateSchema, response: { 201: serverSummarySchema } } },
    async (request, reply) => {
      const { user } = auth.requireSuperadmin(request);
      await assertSlugFree(request.body.slug);
      const server = await servers.create(request.body);
      await auth.audit.record({
        action: 'server.created',
        userId: user.id,
        serverId: server.id,
        ip: request.ip,
        details: { name: server.name, slug: server.slug },
      });
      const access = await servers.access(user, server.id);
      if (access === undefined) throw new Error('A new server must be visible to its creator');
      return reply.code(201).send(servers.summary(access));
    },
  );

  app.get(
    `${base}/:serverId`,
    { schema: { tags, params: serverParams, response: { 200: serverSummarySchema } } },
    async (request) =>
      servers.summary(await servers.require(request, request.params.serverId, CorePermission.view)),
  );

  app.patch(
    `${base}/:serverId`,
    { schema: { tags, params: serverParams, body: serverUpdateSchema } },
    async (request, reply) => {
      const { server, ctx } = await servers.require(
        request,
        request.params.serverId,
        CorePermission.manage,
      );
      const { name, slug } = request.body;
      if (slug !== undefined) await assertSlugFree(slug, server.id);
      await servers.update(server.id, {
        ...(name !== undefined && { name }),
        ...(slug !== undefined && { slug }),
      });
      await auth.audit.record({
        action: 'server.updated',
        userId: ctx.user.id,
        serverId: server.id,
        ip: request.ip,
        details: { name, slug },
      });
      return reply.code(204).send();
    },
  );

  app.delete(
    `${base}/:serverId`,
    { schema: { tags, params: serverParams } },
    async (request, reply) => {
      const { server, ctx } = await servers.require(
        request,
        request.params.serverId,
        CorePermission.manage,
        { sudo: true },
      );
      await servers.delete(server.id);
      await auth.audit.record({
        action: 'server.deleted',
        userId: ctx.user.id,
        serverId: server.id,
        ip: request.ip,
        details: { name: server.name, slug: server.slug },
      });
      return reply.code(204).send();
    },
  );

  // Members

  app.get(
    `${base}/:serverId/members`,
    { schema: { tags, params: serverParams, response: { 200: memberListSchema } } },
    async (request) => {
      const { server, actor } = await servers.require(
        request,
        request.params.serverId,
        CorePermission.members,
      );
      const rows = await auth.db
        .selectFrom('server_members')
        .innerJoin('users', 'users.id', 'server_members.user_id')
        .select([
          'server_members.user_id',
          'users.username',
          'server_members.role_key',
          'server_members.created_at',
        ])
        .where('server_members.server_id', '=', server.id)
        .orderBy('users.username')
        .execute();
      return {
        members: rows.map((row) => ({
          userId: row.user_id,
          username: row.username,
          role: row.role_key,
          createdAt: new Date(row.created_at).toISOString(),
          manageable: canManageRole(actor, row.role_key),
        })),
        assignableRoles: ROLE_KEYS.filter((role) => canManageRole(actor, role)),
      };
    },
  );

  const findMember = (serverId: string, userId: string) =>
    auth.db
      .selectFrom('server_members')
      .innerJoin('users', 'users.id', 'server_members.user_id')
      .select(['server_members.role_key', 'users.username'])
      .where('server_members.server_id', '=', serverId)
      .where('server_members.user_id', '=', userId)
      .executeTakeFirst();

  app.post(
    `${base}/:serverId/members`,
    { schema: { tags, params: serverParams, body: memberAddSchema } },
    async (request, reply) => {
      const { server, actor, ctx } = await servers.require(
        request,
        request.params.serverId,
        CorePermission.members,
        { sudo: true },
      );
      const { username, role } = request.body;
      if (!canManageRole(actor, role)) throw roleNotAllowed();
      const user = await findUserByUsername(auth.db, username);
      if (user === undefined) throw new HttpError(404, 'user_not_found', 'No user with this name');
      if ((await findMember(server.id, user.id)) !== undefined) {
        throw new HttpError(409, 'already_member', 'This user is already a member');
      }
      await auth.db
        .insertInto('server_members')
        .values({ server_id: server.id, user_id: user.id, role_key: role, created_at: Date.now() })
        .execute();
      await auth.audit.record({
        action: 'server.member_added',
        userId: ctx.user.id,
        serverId: server.id,
        target: user.id,
        ip: request.ip,
        details: { username: user.username, role },
      });
      return reply.code(201).send();
    },
  );

  app.patch(
    `${base}/:serverId/members/:userId`,
    { schema: { tags, params: memberParams, body: memberUpdateSchema } },
    async (request, reply) => {
      const { server, actor, ctx } = await servers.require(
        request,
        request.params.serverId,
        CorePermission.members,
        { sudo: true },
      );
      const member = await findMember(server.id, request.params.userId);
      if (member === undefined) throw new HttpError(404, 'not_found', 'No such member');
      const { role } = request.body;
      if (!canManageRole(actor, member.role_key) || !canManageRole(actor, role)) {
        throw roleNotAllowed();
      }
      await auth.db
        .updateTable('server_members')
        .set({ role_key: role })
        .where('server_id', '=', server.id)
        .where('user_id', '=', request.params.userId)
        .execute();
      await auth.audit.record({
        action: 'server.member_updated',
        userId: ctx.user.id,
        serverId: server.id,
        target: request.params.userId,
        ip: request.ip,
        details: { username: member.username, from: member.role_key, role },
      });
      return reply.code(204).send();
    },
  );

  app.delete(
    `${base}/:serverId/members/:userId`,
    { schema: { tags, params: memberParams } },
    async (request, reply) => {
      const { server, actor, ctx } = await servers.require(
        request,
        request.params.serverId,
        CorePermission.members,
        { sudo: true },
      );
      const member = await findMember(server.id, request.params.userId);
      if (member === undefined) throw new HttpError(404, 'not_found', 'No such member');
      if (!canManageRole(actor, member.role_key)) throw roleNotAllowed();
      await auth.db
        .deleteFrom('server_members')
        .where('server_id', '=', server.id)
        .where('user_id', '=', request.params.userId)
        .execute();
      await auth.audit.record({
        action: 'server.member_removed',
        userId: ctx.user.id,
        serverId: server.id,
        target: request.params.userId,
        ip: request.ip,
        details: { username: member.username, role: member.role_key },
      });
      return reply.code(204).send();
    },
  );

  // Invitations to the server: new accounts that become members with a role.

  app.get(
    `${base}/:serverId/invitations`,
    { schema: { tags, params: serverParams, response: { 200: invitationListSchema } } },
    async (request) => {
      const { server } = await servers.require(
        request,
        request.params.serverId,
        CorePermission.members,
      );
      return { invitations: await listInvitations(auth.db, { serverId: server.id }) };
    },
  );

  app.post(
    `${base}/:serverId/invitations`,
    {
      schema: {
        tags,
        params: serverParams,
        body: serverInvitationCreateSchema,
        response: { 201: invitationCreatedSchema },
      },
    },
    async (request, reply) => {
      const { server, actor, ctx } = await servers.require(
        request,
        request.params.serverId,
        CorePermission.members,
        { sudo: true },
      );
      const { role, expiresInDays, note } = request.body;
      if (!canManageRole(actor, role)) throw roleNotAllowed();
      const { token, invitation } = await createInvitation(auth.db, {
        createdBy: ctx.user.id,
        isSuperadmin: false,
        note: note || null,
        lifetimeMs: expiresInDays * DAY_MS,
        serverId: server.id,
        role,
      });
      await auth.audit.record({
        action: 'server.invitation_created',
        userId: ctx.user.id,
        serverId: server.id,
        target: invitation.id,
        ip: request.ip,
        details: { role, expiresInDays },
      });
      return reply.code(201).send({
        invitation: toInvitationInfo(invitation, {
          createdBy: ctx.user.username,
          usedBy: null,
          serverName: server.name,
        }),
        url: invitationUrl(auth.config.publicUrl, token),
      });
    },
  );

  app.delete(
    `${base}/:serverId/invitations/:invitationId`,
    { schema: { tags, params: invitationParams } },
    async (request, reply) => {
      const { server, actor, ctx } = await servers.require(
        request,
        request.params.serverId,
        CorePermission.members,
      );
      const invitation = await findInvitation(auth.db, request.params.invitationId);
      if (invitation === undefined || invitation.server_id !== server.id) {
        throw new HttpError(404, 'not_found', 'No such invitation');
      }
      if (invitation.role_key !== null && !canManageRole(actor, invitation.role_key)) {
        throw roleNotAllowed();
      }
      await deleteInvitation(auth.db, invitation.id);
      await auth.audit.record({
        action: 'server.invitation_deleted',
        userId: ctx.user.id,
        serverId: server.id,
        target: invitation.id,
        ip: request.ip,
      });
      return reply.code(204).send();
    },
  );

  app.get(
    `${base}/:serverId/audit`,
    {
      schema: {
        tags,
        params: serverParams,
        querystring: auditQuerySchema,
        response: { 200: auditPageSchema },
      },
    },
    async (request) => {
      const { server } = await servers.require(
        request,
        request.params.serverId,
        CorePermission.audit,
      );
      return auth.audit.page({ ...cleanFilter(request.query), serverId: server.id });
    },
  );
}

/** Drops unset optional filter values (exactOptionalPropertyTypes). */
export function cleanFilter<T extends Record<string, unknown>>(query: T) {
  return Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== undefined && value !== ''),
  ) as { [K in keyof T]: Exclude<T[K], undefined> } & { limit: number };
}
