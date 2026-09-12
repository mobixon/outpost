import { randomUUID } from 'node:crypto';
import type { CurrentUser } from '@outpost/shared';
import type { Kysely, Selectable, Updateable } from 'kysely';
import type { CoreTables, UsersTable } from '../db/schema.js';

export type UserRow = Selectable<UsersTable>;
type UserChanges = Omit<Updateable<UsersTable>, 'id' | 'created_at' | 'updated_at'>;

export function findUserByUsername(db: Kysely<CoreTables>, username: string) {
  return db.selectFrom('users').selectAll().where('username', '=', username).executeTakeFirst();
}

export function findUserById(db: Kysely<CoreTables>, id: string) {
  return db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
}

export async function countUsers(db: Kysely<CoreTables>): Promise<number> {
  const row = await db
    .selectFrom('users')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

export async function createUser(
  db: Kysely<CoreTables>,
  input: { username: string; passwordHash: string | null; isSuperadmin: boolean },
): Promise<UserRow> {
  const now = Date.now();
  const user: UserRow = {
    id: randomUUID(),
    username: input.username,
    password_hash: input.passwordHash,
    is_superadmin: input.isSuperadmin ? 1 : 0,
    totp_secret: null,
    totp_pending_secret: null,
    totp_last_step: null,
    totp_enabled_at: null,
    disabled_at: null,
    created_at: now,
    updated_at: now,
  };
  await db.insertInto('users').values(user).execute();
  return user;
}

export async function updateUser(
  db: Kysely<CoreTables>,
  id: string,
  changes: UserChanges,
): Promise<void> {
  await db
    .updateTable('users')
    .set({ ...changes, updated_at: Date.now() })
    .where('id', '=', id)
    .execute();
}

/**
 * Records a TOTP step as used. Fails when the same or a later step was already used, which also
 * protects against two concurrent requests with the same code.
 */
export async function claimTotpStep(
  db: Kysely<CoreTables>,
  userId: string,
  step: number,
): Promise<boolean> {
  const result = await db
    .updateTable('users')
    .set({ totp_last_step: step })
    .where('id', '=', userId)
    .where((eb) => eb.or([eb('totp_last_step', 'is', null), eb('totp_last_step', '<', step)]))
    .executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
}

export async function replaceBackupCodes(
  db: Kysely<CoreTables>,
  userId: string,
  codeHashes: readonly string[],
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('user_backup_codes').where('user_id', '=', userId).execute();
    await trx
      .insertInto('user_backup_codes')
      .values(codeHashes.map((code_hash) => ({ user_id: userId, code_hash, used_at: null })))
      .execute();
  });
}

export async function deleteBackupCodes(db: Kysely<CoreTables>, userId: string): Promise<void> {
  await db.deleteFrom('user_backup_codes').where('user_id', '=', userId).execute();
}

/** Marks an unused backup code as used; false when the code does not exist or was used. */
export async function consumeBackupCode(
  db: Kysely<CoreTables>,
  userId: string,
  codeHash: string,
): Promise<boolean> {
  const result = await db
    .updateTable('user_backup_codes')
    .set({ used_at: Date.now() })
    .where('user_id', '=', userId)
    .where('code_hash', '=', codeHash)
    .where('used_at', 'is', null)
    .executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
}

export async function toCurrentUser(db: Kysely<CoreTables>, user: UserRow): Promise<CurrentUser> {
  const row = await db
    .selectFrom('user_backup_codes')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('user_id', '=', user.id)
    .where('used_at', 'is', null)
    .executeTakeFirstOrThrow();
  return {
    id: user.id,
    username: user.username,
    isSuperadmin: user.is_superadmin === 1,
    twoFactorEnabled: user.totp_enabled_at !== null,
    backupCodesLeft: Number(row.count),
    createdAt: new Date(user.created_at).toISOString(),
  };
}
