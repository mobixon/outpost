import { randomUUID } from 'node:crypto';
import type { Kysely, Selectable } from 'kysely';
import type { CoreTables, SessionsTable } from '../db/schema.js';
import { randomToken, sha256 } from './crypto.js';

export type SessionRow = Selectable<SessionsTable>;
export type SessionStatus = SessionRow['status'];

/** A session ends after a week without activity… */
export const SESSION_IDLE_TTL_MS = 7 * 24 * 60 * 60_000;
/** …and after 30 days in any case. */
export const SESSION_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60_000;
/** Time to enter the second factor after the password. */
export const MFA_PENDING_TTL_MS = 5 * 60_000;
/** Sensitive actions are allowed this long after the password was entered. */
export const SUDO_TTL_MS = 10 * 60_000;
/** `last_seen_at` is written at most this often, to avoid a database write on every request. */
const TOUCH_INTERVAL_MS = 60_000;

export interface ClientInfo {
  ip: string;
  userAgent: string | undefined;
}

export function isExpired(session: SessionRow, now: number): boolean {
  if (now >= session.expires_at) return true;
  return session.status === 'active' && now - session.last_seen_at >= SESSION_IDLE_TTL_MS;
}

export class SessionStore {
  constructor(private readonly db: Kysely<CoreTables>) {}

  /** Creates a session and returns the cookie token. Only a hash of the token is stored. */
  async create(
    userId: string,
    status: SessionStatus,
    client: ClientInfo,
    options: { sudo?: boolean } = {},
  ): Promise<{ token: string; session: SessionRow }> {
    const now = Date.now();
    const token = randomToken();
    const session: SessionRow = {
      id: randomUUID(),
      token_hash: sha256(token),
      user_id: userId,
      status,
      created_at: now,
      last_seen_at: now,
      expires_at: now + (status === 'mfa' ? MFA_PENDING_TTL_MS : SESSION_ABSOLUTE_TTL_MS),
      sudo_until: options.sudo ? now + SUDO_TTL_MS : null,
      ip: client.ip,
      user_agent: client.userAgent?.slice(0, 300) ?? null,
    };
    await this.db.insertInto('sessions').values(session).execute();
    return { token, session };
  }

  /** The session of a cookie token; expired sessions are deleted and not returned. */
  async findByToken(token: string): Promise<SessionRow | undefined> {
    const session = await this.db
      .selectFrom('sessions')
      .selectAll()
      .where('token_hash', '=', sha256(token))
      .executeTakeFirst();
    if (session === undefined) return undefined;
    if (isExpired(session, Date.now())) {
      await this.delete(session.id);
      return undefined;
    }
    return session;
  }

  async touch(session: SessionRow): Promise<void> {
    const now = Date.now();
    if (now - session.last_seen_at < TOUCH_INTERVAL_MS) return;
    await this.db
      .updateTable('sessions')
      .set({ last_seen_at: now })
      .where('id', '=', session.id)
      .execute();
    session.last_seen_at = now;
  }

  async startSudo(session: SessionRow): Promise<number> {
    const until = Date.now() + SUDO_TTL_MS;
    await this.db
      .updateTable('sessions')
      .set({ sudo_until: until })
      .where('id', '=', session.id)
      .execute();
    session.sudo_until = until;
    return until;
  }

  /** Active, unexpired sessions of a user, most recently used first. */
  async listActive(userId: string): Promise<SessionRow[]> {
    const now = Date.now();
    const sessions = await this.db
      .selectFrom('sessions')
      .selectAll()
      .where('user_id', '=', userId)
      .where('status', '=', 'active')
      .orderBy('last_seen_at', 'desc')
      .execute();
    return sessions.filter((session) => !isExpired(session, now));
  }

  async delete(id: string): Promise<void> {
    await this.db.deleteFrom('sessions').where('id', '=', id).execute();
  }

  /** Deletes a session only if it belongs to the user; false when there was none. */
  async deleteOwned(userId: string, id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('sessions')
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  }

  async deleteForUser(userId: string, exceptId?: string): Promise<void> {
    let query = this.db.deleteFrom('sessions').where('user_id', '=', userId);
    if (exceptId !== undefined) query = query.where('id', '!=', exceptId);
    await query.execute();
  }
}
