import { randomUUID } from 'node:crypto';
import { HttpError, type ServerInfo } from '@outpost/plugin-api';
import {
  Capability,
  CorePermission,
  gameIdSchema,
  type ConnectionInfo,
  type ConnectorType,
  type FilesInfo,
  type FilesInput,
  type GameId,
  type RoleKey,
  type ServerSummary,
} from '@outpost/shared';
import type { FastifyRequest } from 'fastify';
import type { Kysely, Selectable } from 'kysely';
import { z } from 'zod';
import { SecretBox } from '../auth/crypto.js';
import type { AuthContext, AuthService } from '../auth/service.js';
import type { UserRow } from '../auth/users.js';
import type { CoreTables, ServersTable } from '../db/schema.js';
import type { FilesSettings } from '../files/access.js';
import type { PermissionRegistry } from '../rbac/permissions.js';

export type ServerRow = Selectable<ServersTable>;

const storedConnectionSchema = z.object({
  type: z.literal('rcon'),
  host: z.string(),
  port: z.number().int(),
  /** Sealed with the key for server connections. */
  password: z.string(),
});
export type StoredConnection = z.infer<typeof storedConnectionSchema>;

const storedFilesSchema = z.object({
  source: z.literal('folder'),
  /** Relative to OUTPOST_FILES_ROOT. */
  path: z.string(),
  writable: z.boolean(),
});
type StoredFiles = z.infer<typeof storedFilesSchema>;

export interface RconSettings {
  host: string;
  port: number;
  password: string;
}

/** What a user may do on one server. */
export interface ServerAccess {
  server: ServerRow;
  /** The membership role; null for superadmins who are not members. */
  role: RoleKey | null;
  /** Who manages members: the role, or `superadmin` for superadmins. */
  actor: RoleKey | 'superadmin';
  permissions: ReadonlySet<string>;
}

type AccessUser = Pick<UserRow, 'id' | 'is_superadmin'>;

/** Parses a JSON column; null when it is empty or cannot be read. */
function parseColumn<T>(value: string | null, schema: z.ZodType<T>): T | null {
  if (value === null) return null;
  try {
    return schema.parse(JSON.parse(value));
  } catch {
    return null;
  }
}

/**
 * Game servers and who may do what on them. Members see their servers with the permissions of
 * their role; superadmins see every server with every permission; everyone else sees nothing.
 */
export class ServerService {
  readonly #secrets: SecretBox;

  constructor(
    private readonly db: Kysely<CoreTables>,
    private readonly registry: PermissionRegistry,
    private readonly auth: AuthService,
    secretKey: string,
  ) {
    this.#secrets = new SecretBox(secretKey, 'server-connections');
  }

  find(id: string) {
    return this.db.selectFrom('servers').selectAll().where('id', '=', id).executeTakeFirst();
  }

  list() {
    return this.db.selectFrom('servers').selectAll().orderBy('name').execute();
  }

  async access(user: AccessUser, serverId: string): Promise<ServerAccess | undefined> {
    const server = await this.find(serverId);
    if (server === undefined) return undefined;
    const membership = await this.db
      .selectFrom('server_members')
      .select('role_key')
      .where('server_id', '=', serverId)
      .where('user_id', '=', user.id)
      .executeTakeFirst();
    return this.#toAccess(user, server, membership?.role_key ?? null);
  }

  /** The servers the user can see, by name. */
  async accessible(user: AccessUser): Promise<ServerAccess[]> {
    const rows = await this.db
      .selectFrom('servers')
      .leftJoin('server_members', (join) =>
        join
          .onRef('server_members.server_id', '=', 'servers.id')
          .on('server_members.user_id', '=', user.id),
      )
      .selectAll('servers')
      .select('server_members.role_key')
      .orderBy('servers.name')
      .execute();
    return rows.flatMap(({ role_key, ...server }) => {
      const access = this.#toAccess(user, server, role_key);
      return access === undefined ? [] : [access];
    });
  }

  #toAccess(user: AccessUser, server: ServerRow, role: RoleKey | null): ServerAccess | undefined {
    if (user.is_superadmin === 1) {
      return { server, role, actor: 'superadmin', permissions: new Set(this.registry.keys()) };
    }
    if (role === null) return undefined;
    return { server, role, actor: role, permissions: this.registry.forRole(role) };
  }

  /**
   * The server of a request if the signed-in user has the permission on it. Answers 404 when the
   * user cannot see the server at all, so its existence is not revealed, and 403 otherwise.
   */
  async require(
    request: FastifyRequest,
    serverId: string,
    permission: string,
    options: { sudo?: boolean } = {},
  ): Promise<ServerAccess & { ctx: AuthContext }> {
    const ctx = this.auth.requireUser(request);
    const access = await this.access(ctx.user, serverId);
    if (access === undefined) throw new HttpError(404, 'not_found', 'No such server');
    if (!access.permissions.has(permission)) {
      throw new HttpError(403, 'forbidden', 'You do not have permission to do this');
    }
    if (options.sudo) this.auth.assertSudo(ctx);
    return { ...access, ctx };
  }

  /**
   * The server of a request that changes its connectors. Only superadmins change connectors: a
   * connector points Outpost at a host or folder of its own environment, which should not be up to
   * the members of a server.
   */
  async requireConnectorAdmin(
    request: FastifyRequest,
    serverId: string,
    options: { sudo?: boolean } = {},
  ): Promise<ServerAccess & { ctx: AuthContext }> {
    const access = await this.require(request, serverId, CorePermission.manage);
    if (access.actor !== 'superadmin') {
      throw new HttpError(403, 'forbidden', 'Only superadmins can change the connectors');
    }
    if (options.sudo) this.auth.assertSudo(access.ctx);
    return access;
  }

  /** The stored RCON connector; null when there is none or it cannot be read. */
  connectionOf(server: ServerRow): StoredConnection | null {
    return parseColumn(server.connection, storedConnectionSchema);
  }

  /** The stored Files connector; null when there is none or it cannot be read. */
  filesOf(server: ServerRow): StoredFiles | null {
    return parseColumn(server.files, storedFilesSchema);
  }

  gameOf(server: ServerRow): GameId | null {
    return gameIdSchema.safeParse(server.game).data ?? null;
  }

  connectors(server: ServerRow): ConnectorType[] {
    const connectors: ConnectorType[] = [];
    if (this.connectionOf(server) !== null) connectors.push('rcon');
    if (this.filesOf(server) !== null) connectors.push('files');
    return connectors;
  }

  /** What the server supports: the union of what its connectors add. */
  capabilities(server: ServerRow): string[] {
    const capabilities: string[] = [];
    if (this.connectionOf(server) !== null) capabilities.push(Capability.commandsSend);
    const files = this.filesOf(server);
    if (files !== null) capabilities.push(Capability.filesRead);
    if (files?.writable === true) capabilities.push(Capability.filesWrite);
    return capabilities;
  }

  connectionInfo(server: ServerRow): ConnectionInfo | null {
    const connection = this.connectionOf(server);
    const game = this.gameOf(server);
    if (connection === null || game === null) return null;
    return {
      type: connection.type,
      game,
      host: connection.host,
      port: connection.port,
      hasPassword: connection.password !== '',
    };
  }

  /** Stores an RCON connection; without a new password the stored one is kept. */
  async saveConnection(
    server: ServerRow,
    input: { game: GameId; host: string; port: number; password?: string | undefined },
  ): Promise<void> {
    const password =
      input.password !== undefined
        ? this.#secrets.seal(input.password)
        : this.connectionOf(server)?.password;
    if (password === undefined) {
      throw new HttpError(400, 'rcon_password_required', 'Enter the RCON password');
    }
    const connection: StoredConnection = {
      type: 'rcon',
      host: input.host,
      port: input.port,
      password,
    };
    await this.db
      .updateTable('servers')
      .set({ game: input.game, connection: JSON.stringify(connection), updated_at: Date.now() })
      .where('id', '=', server.id)
      .execute();
  }

  async removeConnection(id: string): Promise<void> {
    await this.db
      .updateTable('servers')
      .set({ connection: null, updated_at: Date.now() })
      .where('id', '=', id)
      .execute();
  }

  /** The stored RCON password in plain text. */
  openPassword(connection: StoredConnection): string {
    return this.#secrets.open(connection.password);
  }

  /** Where and how to reach the server over RCON; undefined without a connection. */
  async rconSettings(serverId: string): Promise<RconSettings | undefined> {
    const server = await this.find(serverId);
    const connection = server === undefined ? null : this.connectionOf(server);
    if (connection === null) return undefined;
    return {
      host: connection.host,
      port: connection.port,
      password: this.openPassword(connection),
    };
  }

  filesInfo(server: ServerRow): FilesInfo | null {
    return this.filesOf(server);
  }

  async saveFiles(id: string, input: FilesInput): Promise<void> {
    const files: StoredFiles = { source: input.source, path: input.path, writable: input.writable };
    await this.db
      .updateTable('servers')
      .set({ files: JSON.stringify(files), updated_at: Date.now() })
      .where('id', '=', id)
      .execute();
  }

  async removeFiles(id: string): Promise<void> {
    await this.db
      .updateTable('servers')
      .set({ files: null, updated_at: Date.now() })
      .where('id', '=', id)
      .execute();
  }

  /** The folder of the server for `ctx.files`; undefined without a Files connector. */
  async filesSettings(serverId: string): Promise<FilesSettings | undefined> {
    const server = await this.find(serverId);
    const files = server === undefined ? null : this.filesOf(server);
    return files === null ? undefined : { path: files.path, writable: files.writable };
  }

  info(server: ServerRow): ServerInfo {
    return {
      id: server.id,
      slug: server.slug,
      name: server.name,
      game: this.gameOf(server),
      capabilities: this.capabilities(server),
    };
  }

  summary({ server, role, permissions }: ServerAccess): ServerSummary {
    return {
      id: server.id,
      slug: server.slug,
      name: server.name,
      role,
      permissions: [...permissions].sort(),
      capabilities: this.capabilities(server),
      connectors: this.connectors(server),
      game: this.gameOf(server),
      createdAt: new Date(server.created_at).toISOString(),
    };
  }

  async slugTaken(slug: string, exceptId?: string): Promise<boolean> {
    let query = this.db.selectFrom('servers').select('id').where('slug', '=', slug);
    if (exceptId !== undefined) query = query.where('id', '!=', exceptId);
    return (await query.executeTakeFirst()) !== undefined;
  }

  async create(input: { name: string; slug: string }): Promise<ServerRow> {
    const now = Date.now();
    const server: ServerRow = {
      id: randomUUID(),
      slug: input.slug,
      name: input.name,
      game: null,
      connection: null,
      files: null,
      created_at: now,
      updated_at: now,
    };
    await this.db.insertInto('servers').values(server).execute();
    return server;
  }

  async update(id: string, changes: { name?: string; slug?: string }): Promise<void> {
    await this.db
      .updateTable('servers')
      .set({ ...changes, updated_at: Date.now() })
      .where('id', '=', id)
      .execute();
  }

  /** Deletes the server with its members, invitations and plugin data; the audit log stays. */
  async delete(id: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('plugin_kv').where('scope', '=', id).execute();
      await trx.deleteFrom('servers').where('id', '=', id).execute();
    });
  }
}
