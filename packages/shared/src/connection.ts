import { z } from 'zod';

/** Games Outpost knows. */
export const GAME_IDS = ['minecraft-java'] as const;
export type GameId = (typeof GAME_IDS)[number];
export const gameIdSchema = z.enum(GAME_IDS);

/**
 * How Outpost reaches a server: `rcon` sends console commands over RCON; `full` adds Docker (live
 * log, status) and file access and arrives in a later version.
 */
export const CONNECTION_TYPES = ['rcon', 'full'] as const;
export type ConnectionType = (typeof CONNECTION_TYPES)[number];

export const RCON_DEFAULT_PORT = 25575;

/** Host names, IPv4 addresses and IPv6 addresses. */
const hostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const rconConnectionInputSchema = z.object({
  type: z.literal('rcon'),
  game: gameIdSchema,
  host: hostSchema,
  port: z.number().int().min(1).max(65535),
  /** Omit to keep the stored password. */
  password: z.string().min(1).max(512).optional(),
});
export type RconConnectionInput = z.infer<typeof rconConnectionInputSchema>;

/** A connection as the API shows it; the password never leaves the server. */
export const connectionInfoSchema = z.object({
  type: z.literal('rcon'),
  game: gameIdSchema,
  host: z.string(),
  port: z.number().int(),
  hasPassword: z.boolean(),
});
export type ConnectionInfo = z.infer<typeof connectionInfoSchema>;

export const connectionStateSchema = z.object({
  connection: connectionInfoSchema.nullable(),
});

export const CONNECTION_TEST_STEPS = ['connect', 'auth', 'command'] as const;

export const connectionTestResultSchema = z.object({
  ok: z.boolean(),
  steps: z.array(
    z.object({
      step: z.enum(CONNECTION_TEST_STEPS),
      /** null when the step did not run because an earlier one failed. */
      ok: z.boolean().nullable(),
      /** Error code of a failed step, e.g. `connection_refused` or `auth_failed`. */
      error: z.string().nullable(),
      /** The reply of the test command. */
      detail: z.string().nullable(),
    }),
  ),
});
export type ConnectionTestResult = z.infer<typeof connectionTestResultSchema>;

export const serverStatusSchema = z.object({
  /** null when the server has no connection. */
  reachable: z.boolean().nullable(),
  /** Error code when the server cannot be reached. */
  error: z.string().nullable(),
  players: z
    .object({
      online: z.number().int(),
      max: z.number().int(),
      names: z.array(z.string()),
    })
    .nullable(),
  checkedAt: z.string(),
});
export type ServerStatus = z.infer<typeof serverStatusSchema>;
