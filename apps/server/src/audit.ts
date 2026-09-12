import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Kysely } from 'kysely';
import type { CoreTables } from './db/schema.js';

export interface AuditEntry {
  /** Dotted name such as `auth.login` or `outpost.players.ban`. */
  action: string;
  userId?: string | null;
  target?: string | null;
  details?: Record<string, unknown> | null;
  ip?: string | null;
}

export class AuditLog {
  constructor(
    private readonly db: Kysely<CoreTables>,
    private readonly log: FastifyBaseLogger,
  ) {}

  /**
   * Never throws: a failure to write the audit log must not undo the action that was already
   * performed, but it is logged as an error.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.db
        .insertInto('audit_log')
        .values({
          id: randomUUID(),
          at: Date.now(),
          user_id: entry.userId ?? null,
          action: entry.action,
          target: entry.target ?? null,
          details: entry.details ? JSON.stringify(entry.details) : null,
          ip: entry.ip ?? null,
        })
        .execute();
    } catch (err) {
      this.log.error({ err, action: entry.action }, 'failed to write the audit log');
    }
  }
}
