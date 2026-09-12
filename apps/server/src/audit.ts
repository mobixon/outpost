import { randomUUID } from 'node:crypto';
import { HttpError } from '@outpost/plugin-api';
import type { AuditEntry as AuditEntryInfo } from '@outpost/shared';
import type { FastifyBaseLogger } from 'fastify';
import { sql, type Kysely } from 'kysely';
import type { CoreTables } from './db/schema.js';

export interface AuditEntry {
  /** Dotted name such as `auth.login` or `outpost.players.ban`. */
  action: string;
  userId?: string | null;
  /** The game server the action concerns. */
  serverId?: string | null;
  target?: string | null;
  details?: Record<string, unknown> | null;
  ip?: string | null;
}

export interface AuditFilter {
  serverId?: string;
  /** Actions starting with this text. */
  action?: string;
  username?: string;
  /** From the previous page: continue with older entries. */
  cursor?: string;
  limit: number;
}

const DAY_MS = 24 * 60 * 60_000;
const CURSOR_PATTERN = /^(\d+):([\w-]+)$/;

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
          server_id: entry.serverId ?? null,
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

  /** Entries matching the filter, newest first, one page at a time. */
  async page(
    filter: AuditFilter,
  ): Promise<{ entries: AuditEntryInfo[]; nextCursor: string | null }> {
    let query = this.db
      .selectFrom('audit_log')
      .leftJoin('users', 'users.id', 'audit_log.user_id')
      .leftJoin('servers', 'servers.id', 'audit_log.server_id')
      .select([
        'audit_log.id',
        'audit_log.at',
        'audit_log.user_id',
        'audit_log.server_id',
        'audit_log.action',
        'audit_log.target',
        'audit_log.details',
        'audit_log.ip',
        'users.username',
        'servers.name as server_name',
      ]);
    if (filter.serverId !== undefined) {
      query = query.where('audit_log.server_id', '=', filter.serverId);
    }
    if (filter.action) {
      const prefix = filter.action;
      query = query.where(
        sql<boolean>`substr(${sql.ref('audit_log.action')}, 1, ${sql.lit(prefix.length)}) = ${prefix}`,
      );
    }
    if (filter.username) query = query.where('users.username', '=', filter.username);
    if (filter.cursor !== undefined) {
      const match = CURSOR_PATTERN.exec(filter.cursor);
      if (match === null) throw new HttpError(400, 'invalid_cursor', 'The cursor is not valid');
      const at = Number(match[1]);
      const id = match[2] ?? '';
      query = query.where((eb) =>
        eb.or([
          eb('audit_log.at', '<', at),
          eb.and([eb('audit_log.at', '=', at), eb('audit_log.id', '<', id)]),
        ]),
      );
    }
    const rows = await query
      .orderBy('audit_log.at', 'desc')
      .orderBy('audit_log.id', 'desc')
      .limit(filter.limit + 1)
      .execute();

    const page = rows.slice(0, filter.limit);
    const last = page.at(-1);
    return {
      entries: page.map((row) => ({
        id: row.id,
        at: new Date(Number(row.at)).toISOString(),
        userId: row.user_id,
        username: row.username,
        serverId: row.server_id,
        serverName: row.server_name,
        action: row.action,
        target: row.target,
        details: parseDetails(row.details),
        ip: row.ip,
      })),
      nextCursor: rows.length > filter.limit && last ? `${Number(last.at)}:${last.id}` : null,
    };
  }

  /** Deletes entries older than the retention period; 0 keeps everything. */
  async prune(retentionDays: number): Promise<void> {
    if (retentionDays <= 0) return;
    try {
      await this.db
        .deleteFrom('audit_log')
        .where('at', '<', Date.now() - retentionDays * DAY_MS)
        .execute();
    } catch (err) {
      this.log.error({ err }, 'failed to prune the audit log');
    }
  }
}

function parseDetails(details: string | null): Record<string, unknown> | null {
  if (details === null) return null;
  try {
    const value: unknown = JSON.parse(details);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
