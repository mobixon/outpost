import { randomUUID } from 'node:crypto';
import type { InvitationInfo, RoleKey } from '@outpost/shared';
import type { Kysely, Selectable } from 'kysely';
import type { CoreTables, InvitationsTable } from '../db/schema.js';
import { randomToken, sha256 } from './crypto.js';
import { linkIdentity } from './identities.js';
import { createUser, findUserByUsername, type UserRow } from './users.js';

export type InvitationRow = Selectable<InvitationsTable>;

export class InvitationError extends Error {
  override name = 'InvitationError';

  constructor(readonly code: 'invitation_invalid' | 'username_taken') {
    super(
      code === 'username_taken'
        ? 'This username is taken'
        : 'The invitation is not valid: it was used, has expired or was withdrawn',
    );
  }
}

/**
 * Creates the account of an invitation: with a password, or with an external identity as its
 * login method, and makes it a member of the invitation's server. Throws InvitationError when
 * the invitation cannot be used or the name is taken.
 */
export async function acceptInvitation(
  db: Kysely<CoreTables>,
  input: {
    token: string;
    username: string;
    passwordHash: string | null;
    identity?: { provider: string; subject: string; displayName: string | null };
  },
): Promise<{ user: UserRow; invitation: InvitationRow }> {
  const invitation = await findPendingInvitation(db, input.token);
  if (invitation === undefined) throw new InvitationError('invitation_invalid');
  if ((await findUserByUsername(db, input.username)) !== undefined) {
    throw new InvitationError('username_taken');
  }
  return db.transaction().execute(async (trx) => {
    const user = await createUser(trx, {
      username: input.username,
      passwordHash: input.passwordHash,
      isSuperadmin: invitation.is_superadmin === 1,
    });
    if (input.identity !== undefined) {
      await linkIdentity(trx, { userId: user.id, ...input.identity });
    }
    if (invitation.server_id !== null && invitation.role_key !== null) {
      await trx
        .insertInto('server_members')
        .values({
          server_id: invitation.server_id,
          user_id: user.id,
          role_key: invitation.role_key,
          created_at: Date.now(),
        })
        .execute();
    }
    if (!(await claimInvitation(trx, invitation.id, user.id))) {
      throw new InvitationError('invitation_invalid');
    }
    return { user, invitation };
  });
}

/** Used and expired invitations stay listed this long, then they are deleted. */
const INVITATION_HISTORY_MS = 30 * 24 * 60 * 60_000;

/** Creates an invitation and returns the token for the link. Only a hash of it is stored. */
export async function createInvitation(
  db: Kysely<CoreTables>,
  input: {
    createdBy: string;
    isSuperadmin: boolean;
    note: string | null;
    lifetimeMs: number;
    serverId?: string | null;
    role?: RoleKey | null;
  },
): Promise<{ token: string; invitation: InvitationRow }> {
  const now = Date.now();
  const token = randomToken();
  const invitation: InvitationRow = {
    id: randomUUID(),
    token_hash: sha256(token),
    is_superadmin: input.isSuperadmin ? 1 : 0,
    note: input.note,
    created_by: input.createdBy,
    created_at: now,
    expires_at: now + input.lifetimeMs,
    used_by: null,
    used_at: null,
    server_id: input.serverId ?? null,
    role_key: input.role ?? null,
  };
  await db.insertInto('invitations').values(invitation).execute();
  return { token, invitation };
}

/** The invitation of a link token, if it can still be accepted. */
export function findPendingInvitation(db: Kysely<CoreTables>, token: string) {
  return db
    .selectFrom('invitations')
    .leftJoin('users', 'users.id', 'invitations.created_by')
    .leftJoin('servers', 'servers.id', 'invitations.server_id')
    .selectAll('invitations')
    .select(['users.username as created_by_username', 'servers.name as server_name'])
    .where('invitations.token_hash', '=', sha256(token))
    .where('invitations.used_at', 'is', null)
    .where('invitations.expires_at', '>', Date.now())
    .executeTakeFirst();
}

export function findInvitation(db: Kysely<CoreTables>, id: string) {
  return db.selectFrom('invitations').selectAll().where('id', '=', id).executeTakeFirst();
}

/**
 * Marks the invitation as used by the new account. Fails when it was used or has expired in the
 * meantime, so an invitation can never create two accounts. Run it in the transaction that creates
 * the account.
 */
export async function claimInvitation(
  db: Kysely<CoreTables>,
  id: string,
  userId: string,
): Promise<boolean> {
  const now = Date.now();
  const result = await db
    .updateTable('invitations')
    .set({ used_by: userId, used_at: now })
    .where('id', '=', id)
    .where('used_at', 'is', null)
    .where('expires_at', '>', now)
    .executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
}

/**
 * Invitations newest first, all or those of one server; old used and expired ones are deleted
 * first.
 */
export async function listInvitations(
  db: Kysely<CoreTables>,
  filter: { serverId?: string } = {},
): Promise<InvitationInfo[]> {
  const cutoff = Date.now() - INVITATION_HISTORY_MS;
  await db
    .deleteFrom('invitations')
    .where((eb) => eb.or([eb('used_at', '<', cutoff), eb('expires_at', '<', cutoff)]))
    .execute();
  let query = db
    .selectFrom('invitations')
    .leftJoin('users as creator', 'creator.id', 'invitations.created_by')
    .leftJoin('users as invitee', 'invitee.id', 'invitations.used_by')
    .leftJoin('servers', 'servers.id', 'invitations.server_id')
    .selectAll('invitations')
    .select([
      'creator.username as created_by_username',
      'invitee.username as used_by_username',
      'servers.name as server_name',
    ]);
  if (filter.serverId !== undefined) {
    query = query.where('invitations.server_id', '=', filter.serverId);
  }
  const rows = await query.orderBy('invitations.created_at', 'desc').execute();
  return rows.map((row) =>
    toInvitationInfo(row, {
      createdBy: row.created_by_username,
      usedBy: row.used_by_username,
      serverName: row.server_name,
    }),
  );
}

export async function deleteInvitation(db: Kysely<CoreTables>, id: string): Promise<boolean> {
  const result = await db.deleteFrom('invitations').where('id', '=', id).executeTakeFirst();
  return Number(result.numDeletedRows) > 0;
}

export function toInvitationInfo(
  row: InvitationRow,
  names: { createdBy: string | null; usedBy: string | null; serverName: string | null },
): InvitationInfo {
  const now = Date.now();
  return {
    id: row.id,
    isSuperadmin: row.is_superadmin === 1,
    serverId: row.server_id,
    serverName: names.serverName,
    role: row.role_key,
    note: row.note,
    createdBy: names.createdBy,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    status: row.used_at !== null ? 'used' : row.expires_at <= now ? 'expired' : 'pending',
    usedBy: names.usedBy,
  };
}
