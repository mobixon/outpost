import { z } from 'zod';

/** Games Outpost knows. */
export const GAME_IDS = ['minecraft-java'] as const;
export type GameId = (typeof GAME_IDS)[number];
export const gameIdSchema = z.enum(GAME_IDS);

/**
 * Connectors link a server to Outpost. Each one is set up and tested on its own and adds
 * capabilities: `rcon` sends console commands, `files` reads and writes the files of the server.
 */
export const CONNECTOR_TYPES = ['rcon', 'files'] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

/** Capabilities of the core connectors. Modules check capabilities, never connector types. */
export const Capability = {
  /** Run console commands (RCON). */
  commandsSend: 'commands.send',
  /** Read the files of the server. */
  filesRead: 'files.read',
  /** Write the files of the server. */
  filesWrite: 'files.write',
} as const;

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

/** The result of a connector test: every step with its outcome. */
function testResultSchema<const Steps extends readonly [string, ...string[]]>(steps: Steps) {
  return z.object({
    ok: z.boolean(),
    steps: z.array(
      z.object({
        step: z.enum(steps),
        /** null when the step did not run because an earlier one failed. */
        ok: z.boolean().nullable(),
        /** Error code of a failed step, e.g. `connection_refused` or `folder_not_found`. */
        error: z.string().nullable(),
        /** What the step found, e.g. the reply of the test command. */
        detail: z.string().nullable(),
      }),
    ),
  });
}

export const CONNECTION_TEST_STEPS = ['connect', 'auth', 'command'] as const;
export const connectionTestResultSchema = testResultSchema(CONNECTION_TEST_STEPS);
export type ConnectionTestResult = z.infer<typeof connectionTestResultSchema>;

/** A folder below OUTPOST_FILES_ROOT, e.g. `survival` or `games/survival`. */
const folderSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/)
  .refine((path) => path.split('/').every((segment) => segment !== '.' && segment !== '..'), {
    message: 'Must not contain . or .. segments',
  });

/** Where the files of a server come from: `folder` is a directory mounted into Outpost. */
export const FILE_SOURCES = ['folder'] as const;

export const filesInputSchema = z.object({
  source: z.enum(FILE_SOURCES),
  /** The server's folder, relative to OUTPOST_FILES_ROOT. */
  path: folderSchema,
  /** Modules may write files; the test checks that writing works. */
  writable: z.boolean(),
});
export type FilesInput = z.infer<typeof filesInputSchema>;

export const filesInfoSchema = z.object({
  source: z.enum(FILE_SOURCES),
  path: z.string(),
  writable: z.boolean(),
});
export type FilesInfo = z.infer<typeof filesInfoSchema>;

export const filesStateSchema = z.object({
  /** OUTPOST_FILES_ROOT: the folders of the servers lie below it. */
  root: z.string(),
  files: filesInfoSchema.nullable(),
});

export const FILES_TEST_STEPS = ['folder', 'properties', 'write'] as const;
export const filesTestResultSchema = testResultSchema(FILES_TEST_STEPS);
export type FilesTestResult = z.infer<typeof filesTestResultSchema>;

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
