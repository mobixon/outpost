import { ipAddressSchema, playerNameSchema } from '@outpost/shared';
import { z } from 'zod';

export const PLAYERS_PLUGIN_ID = 'outpost.players';

export const PlayersPermission = {
  view: 'players.view',
  kick: 'players.kick',
  ban: 'players.ban',
  whitelist: 'players.whitelist',
  op: 'players.op',
} as const;

export const serverModeSchema = z.enum(['online', 'offline']);
export type ServerMode = z.infer<typeof serverModeSchema>;

const reasonSchema = z.string().max(200).optional();

export const nameRequestSchema = z.object({ name: playerNameSchema });
export const nameReasonRequestSchema = z.object({ name: playerNameSchema, reason: reasonSchema });
export const ipRequestSchema = z.object({ ip: ipAddressSchema, reason: reasonSchema });
export const whitelistStateRequestSchema = z.object({ enabled: z.boolean() });
export const modeRequestSchema = z.object({ mode: z.enum(['auto', 'online', 'offline']) });

export const actionResultSchema = z.object({
  /** The server's reply, without formatting codes. */
  reply: z.string(),
  /** The action waits until the player is seen online (never-seen players on offline servers). */
  pending: z.boolean(),
  /**
   * `offline_unknown_player`: whitelisted over RCON, but may get the wrong UUID (offline mode);
   * `applies_on_restart`: whitelist.json has changed, but the server loads it only when it starts
   * (no RCON to reload it, or the server is down).
   */
  warning: z.enum(['offline_unknown_player', 'applies_on_restart']).nullable(),
});
export type ActionResult = z.infer<typeof actionResultSchema>;

export const whitelistEntrySchema = z.object({
  name: z.string(),
  /** From whitelist.json; null when the list came over RCON. */
  uuid: z.string().nullable(),
  /** The UUID does not fit the mode of the server, so the player cannot join (UUID doctor). */
  wrongUuid: z.boolean(),
});

export const whitelistSchema = z.object({
  /** Where the list comes from: whitelist.json (Files connector) or `whitelist list` over RCON. */
  source: z.enum(['file', 'rcon']),
  /** How it is changed: in whitelist.json, over RCON, or not at all (read-only files, no RCON). */
  change: z.enum(['file', 'rcon']).nullable(),
  /** Whether the whitelist is on (`white-list` of server.properties); null when unknown. */
  enabled: z.boolean().nullable(),
  /** Changes of whitelist.json apply at once (RCON `whitelist reload`), not at the next start. */
  reloads: z.boolean(),
  /** Entries with a wrong UUID can be fixed: writable files of an offline-mode server. */
  fixable: z.boolean(),
  entries: z.array(whitelistEntrySchema),
});
export type Whitelist = z.infer<typeof whitelistSchema>;

export const pendingActionSchema = z.object({
  id: z.string(),
  name: z.string(),
  action: z.enum(['ban', 'op']),
  reason: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
});
export type PendingAction = z.infer<typeof pendingActionSchema>;

export const banEntrySchema = z.object({
  target: z.string(),
  source: z.string(),
  reason: z.string(),
});
export type Ban = z.infer<typeof banEntrySchema>;

export const overviewSchema = z.object({
  /** The server answered; otherwise the lists are null and `error` tells why. */
  reachable: z.boolean(),
  error: z.string().nullable(),
  mode: z.object({
    /** The override if set, else what the UUIDs of players online showed, else server.properties. */
    effective: serverModeSchema.nullable(),
    detected: serverModeSchema.nullable(),
    /** `online-mode` of server.properties; null without the Files connector. */
    configured: serverModeSchema.nullable(),
    override: serverModeSchema.nullable(),
  }),
  /** The server has RCON, which who is online, bans, kicks and operators need. */
  rcon: z.boolean(),
  max: z.number().int().nullable(),
  online: z.array(z.object({ uuid: z.string(), name: z.string(), since: z.string().nullable() })),
  whitelist: whitelistSchema.nullable(),
  /** Why whitelist.json could not be read, e.g. `whitelist_invalid`. */
  whitelistError: z.string().nullable(),
  bans: z.array(banEntrySchema).nullable(),
  ipBans: z.array(banEntrySchema).nullable(),
  pending: z.array(pendingActionSchema),
});
export type Overview = z.infer<typeof overviewSchema>;

export const playerSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  firstSeen: z.string(),
  lastSeen: z.string(),
  /** Playtime of the finished sessions. */
  playtimeMs: z.number(),
  online: z.boolean(),
});
export type Player = z.infer<typeof playerSchema>;

export const playerQuerySchema = z.object({
  search: z.string().trim().max(32).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const playerPageSchema = z.object({
  players: z.array(playerSchema),
  total: z.number().int(),
});

export const playerDetailSchema = z.object({
  player: playerSchema,
  sessions: z.array(
    z.object({
      joinedAt: z.string(),
      /** null while the player is online. */
      leftAt: z.string().nullable(),
    }),
  ),
});
export type PlayerDetail = z.infer<typeof playerDetailSchema>;
