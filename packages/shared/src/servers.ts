import { z } from 'zod';
import { CONNECTION_TYPES, gameIdSchema } from './connection.js';

/** Built-in server roles, from the most to the least powerful. */
export const ROLE_KEYS = ['owner', 'admin', 'moderator', 'viewer'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];
export const roleKeySchema = z.enum(ROLE_KEYS);

/** Permissions of the core. Modules add their own, such as `console.read` or `players.kick`. */
export const CorePermission = {
  /** See the server at all. */
  view: 'server.view',
  /** Rename, connect and delete the server. */
  manage: 'server.manage',
  /** Add, change and remove members and invite people to the server. */
  members: 'members.manage',
  /** Read the server's audit log. */
  audit: 'audit.view',
} as const;

/** 2–32 characters: lowercase letters, digits and dashes, not starting or ending with a dash. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;
export const slugSchema = z.string().trim().toLowerCase().regex(SLUG_PATTERN);
export const serverNameSchema = z.string().trim().min(1).max(64);

export const serverSummarySchema = z.object({
  id: z.string(),
  /** Short name used in URLs of the web UI. */
  slug: z.string(),
  name: z.string(),
  /** The signed-in user's role; null for superadmins who are not members. */
  role: roleKeySchema.nullable(),
  /** What the signed-in user may do on this server. */
  permissions: z.array(z.string()),
  /** What the server supports with its connection and game module (`commands.send`, …). */
  capabilities: z.array(z.string()),
  /** A connection is configured. */
  connected: z.boolean(),
  connectionType: z.enum(CONNECTION_TYPES).nullable(),
  game: gameIdSchema.nullable(),
  createdAt: z.string(),
});
export type ServerSummary = z.infer<typeof serverSummarySchema>;

export const serverListSchema = z.object({
  servers: z.array(serverSummarySchema),
});

export const serverCreateSchema = z.object({
  name: serverNameSchema,
  slug: slugSchema,
});

export const serverUpdateSchema = z
  .object({ name: serverNameSchema.optional(), slug: slugSchema.optional() })
  .refine((body) => body.name !== undefined || body.slug !== undefined, {
    message: 'Nothing to change',
  });

export const memberSchema = z.object({
  userId: z.string(),
  username: z.string(),
  role: roleKeySchema,
  createdAt: z.string(),
  /** The signed-in user may change the role of this member or remove them. */
  manageable: z.boolean(),
});
export type Member = z.infer<typeof memberSchema>;

export const memberListSchema = z.object({
  members: z.array(memberSchema),
  /** Roles the signed-in user may give to members and invited people. */
  assignableRoles: z.array(roleKeySchema),
});

export const memberAddSchema = z.object({
  /** Exact username of an existing account. */
  username: z.string().trim().toLowerCase().min(1).max(64),
  role: roleKeySchema,
});

export const memberUpdateSchema = z.object({
  role: roleKeySchema,
});

export const roleInfoSchema = z.object({
  key: roleKeySchema,
  /** Higher ranks manage lower ones. */
  rank: z.number().int(),
  permissions: z.array(z.string()),
});
export type RoleInfo = z.infer<typeof roleInfoSchema>;

export const roleListSchema = z.object({
  roles: z.array(roleInfoSchema),
});

export const auditEntrySchema = z.object({
  id: z.string(),
  at: z.string(),
  userId: z.string().nullable(),
  /** Null when the account was deleted since. */
  username: z.string().nullable(),
  serverId: z.string().nullable(),
  serverName: z.string().nullable(),
  action: z.string(),
  target: z.string().nullable(),
  details: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditPageSchema = z.object({
  entries: z.array(auditEntrySchema),
  /** Pass as `cursor` to load older entries; null on the last page. */
  nextCursor: z.string().nullable(),
});

export const auditQuerySchema = z.object({
  /** Only actions starting with this text, e.g. `auth.` or `server.member`. */
  action: z.string().trim().max(100).optional(),
  username: z.string().trim().toLowerCase().max(64).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const globalAuditQuerySchema = auditQuerySchema.extend({
  serverId: z.string().optional(),
});
