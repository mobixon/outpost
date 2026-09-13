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
import type { SftpTarget } from '../files/sftp.js';
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

const storedFilesSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('folder'),
    /** Relative to OUTPOST_FILES_ROOT. */
    path: z.string(),
    writable: z.boolean(),
  }),
  z.object({
    source: z.literal('sftp'),
    host: z.string(),
    port: z.number().int(),
    username: z.string(),
    auth: z.enum(['password', 'key']),
    /** The password or the private key, sealed with the key for server connections. */
    secret: z.string(),
    /** The sealed passphrase of the private key. */
    passphrase: z.string().nullable(),
    path: z.string(),
    writable: z.boolean(),
    /** The pinned fingerprint of the host key. */
    hostKey: z.string(),
  }),
]);
type StoredFiles = z.infer<typeof storedFilesSchema>;
type SftpInput = Extract<FilesInput, { source: 'sftp' }>;

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

  /** The Files connector without its secrets. */
  filesInfo(server: ServerRow): FilesInfo | null {
    const files = this.filesOf(server);
    if (files?.source !== 'sftp') return files;
    return {
      source: 'sftp',
      host: files.host,
      port: files.port,
      username: files.username,
      auth: files.auth,
      path: files.path,
      writable: files.writable,
      hostKey: files.hostKey,
    };
  }

  /**
   * Entered SFTP settings as a target. While host, port and username stay the same, the stored
   * password or key (for the same login method) and the pinned host key are kept.
   */
  sftpTarget(server: ServerRow, input: SftpInput): SftpTarget {
    const files = this.filesOf(server);
    const stored =
      files?.source === 'sftp' &&
      files.host === input.host &&
      files.port === input.port &&
      files.username === input.username
        ? files
        : undefined;
    let secret = input.secret;
    let passphrase = input.passphrase;
    if (secret === undefined && stored !== undefined && stored.auth === input.auth) {
      secret = this.#secrets.open(stored.secret);
      passphrase = stored.passphrase === null ? undefined : this.#secrets.open(stored.passphrase);
    }
    if (secret === undefined) {
      throw new HttpError(400, 'sftp_secret_required', 'Enter the password or the private key');
    }
    return {
      host: input.host,
      port: input.port,
      username: input.username,
      auth: input.auth,
      secret,
      passphrase,
      path: input.path,
      hostKey: input.hostKey ?? stored?.hostKey,
    };
  }

  /** Stores the Files connector; SFTP needs the tested target with its pinned host key. */
  async saveFiles(id: string, input: FilesInput, sftp?: SftpTarget): Promise<void> {
    let files: StoredFiles;
    if (input.source === 'folder') {
      files = { source: 'folder', path: input.path, writable: input.writable };
    } else {
      if (sftp?.hostKey === undefined) {
        throw new HttpError(
          400,
          'host_key_required',
          'Test the connection and confirm the host key',
        );
      }
      files = {
        source: 'sftp',
        host: sftp.host,
        port: sftp.port,
        username: sftp.username,
        auth: sftp.auth,
        secret: this.#secrets.seal(sftp.secret),
        passphrase: sftp.passphrase === undefined ? null : this.#secrets.seal(sftp.passphrase),
        path: sftp.path,
        writable: input.writable,
        hostKey: sftp.hostKey,
      };
    }
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

  /** The Files connector of the server for `ctx.files`; undefined without one. */
  async filesSettings(serverId: string): Promise<FilesSettings | undefined> {
    const server = await this.find(serverId);
    const files = server === undefined ? null : this.filesOf(server);
    if (files === null) return undefined;
    if (files.source === 'folder') {
      return { source: 'folder', path: files.path, writable: files.writable };
    }
    return {
      source: 'sftp',
      writable: files.writable,
      target: {
        host: files.host,
        port: files.port,
        username: files.username,
        auth: files.auth,
        secret: this.#secrets.open(files.secret),
        passphrase: files.passphrase === null ? undefined : this.#secrets.open(files.passphrase),
        path: files.path,
        hostKey: files.hostKey,
      },
    };
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
