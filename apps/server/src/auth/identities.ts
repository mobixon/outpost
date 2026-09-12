import type { Kysely, Selectable } from 'kysely';
import type { CoreTables, UserIdentitiesTable } from '../db/schema.js';

export type IdentityRow = Selectable<UserIdentitiesTable>;

export function findIdentity(db: Kysely<CoreTables>, provider: string, subject: string) {
  return db
    .selectFrom('user_identities')
    .selectAll()
    .where('provider', '=', provider)
    .where('subject', '=', subject)
    .executeTakeFirst();
}

export function listIdentities(db: Kysely<CoreTables>, userId: string) {
  return db
    .selectFrom('user_identities')
    .selectAll()
    .where('user_id', '=', userId)
    .orderBy('created_at')
    .execute();
}

export async function linkIdentity(
  db: Kysely<CoreTables>,
  input: { userId: string; provider: string; subject: string; displayName: string | null },
): Promise<void> {
  const now = Date.now();
  await db
    .insertInto('user_identities')
    .values({
      provider: input.provider,
      subject: input.subject,
      user_id: input.userId,
      display_name: input.displayName,
      created_at: now,
      last_used_at: now,
    })
    .execute();
}

/** Records a login with the identity and refreshes the name shown for it. */
export async function touchIdentity(
  db: Kysely<CoreTables>,
  identity: IdentityRow,
  displayName: string | null,
): Promise<void> {
  await db
    .updateTable('user_identities')
    .set({ last_used_at: Date.now(), display_name: displayName ?? identity.display_name })
    .where('provider', '=', identity.provider)
    .where('subject', '=', identity.subject)
    .execute();
}

/** False when the user has no identity at this provider. */
export async function unlinkIdentity(
  db: Kysely<CoreTables>,
  userId: string,
  provider: string,
): Promise<boolean> {
  const result = await db
    .deleteFrom('user_identities')
    .where('user_id', '=', userId)
    .where('provider', '=', provider)
    .executeTakeFirst();
  return Number(result.numDeletedRows) > 0;
}
