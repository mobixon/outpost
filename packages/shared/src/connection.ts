import { z } from 'zod';

/** Games Outpost knows. A server is of one game, chosen when it is added, and never changes. */
export const GAME_IDS = ['minecraft-java'] as const;
export type GameId = (typeof GAME_IDS)[number];
export const gameIdSchema = z.enum(GAME_IDS);

/** Game ids are lowercase words joined by dashes; modules may name games Outpost does not know. */
export const GAME_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** What the connectors need to know about a game. */
export interface GameDefaults {
  /** The usual RCON port of its servers. */
  rconPort: number;
  /** A file in the data folder of every server of the game, which the Files test looks for. */
  dataFile: string;
}

const GAME_DEFAULTS: Record<GameId, GameDefaults> = {
  'minecraft-java': { rconPort: 25575, dataFile: 'server.properties' },
};

/** The defaults of a game; undefined for a game Outpost does not know. */
export function gameDefaults(game: string): GameDefaults | undefined {
  return (GAME_DEFAULTS as Partial<Record<string, GameDefaults>>)[game];
}

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
  host: hostSchema,
  port: z.number().int().min(1).max(65535),
  /** Omit to keep the stored password. */
  password: z.string().min(1).max(512).optional(),
});
export type RconConnectionInput = z.infer<typeof rconConnectionInputSchema>;

/** A connection as the API shows it; the password never leaves the server. */
export const connectionInfoSchema = z.object({
  type: z.literal('rcon'),
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

/** An absolute folder on an SFTP server, e.g. `/` or `/minecraft`. */
const remoteFolderSchema = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .regex(/^\/[^\0\\]*$/)
  .refine((path) => path.split('/').every((segment) => segment !== '..'), {
    message: 'Must not contain .. segments',
  });

/** Where the files of a server come from: a folder mounted into Outpost, or an SFTP server. */
export const FILE_SOURCES = ['folder', 'sftp'] as const;
export type FileSource = (typeof FILE_SOURCES)[number];

export const SFTP_DEFAULT_PORT = 22;
export const SFTP_AUTH_METHODS = ['password', 'key'] as const;

/** Fingerprint of an SSH host key as OpenSSH shows it: `SHA256:` and 43 base64 characters. */
export const HOST_KEY_PATTERN = /^SHA256:[A-Za-z0-9+/]{43}$/;

export const filesInputSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('folder'),
    /** The server's folder, relative to OUTPOST_FILES_ROOT. */
    path: folderSchema,
    /** Modules may write files; the test checks that writing works. */
    writable: z.boolean(),
  }),
  z.object({
    source: z.literal('sftp'),
    host: hostSchema,
    port: z.number().int().min(1).max(65535),
    username: z.string().trim().min(1).max(128),
    auth: z.enum(SFTP_AUTH_METHODS),
    /** The password, or the private key in OpenSSH or PEM format; omit to keep the stored one. */
    secret: z.string().min(1).max(16_384).optional(),
    /** Passphrase of a new private key. */
    passphrase: z.string().min(1).max(1024).optional(),
    /** The server's folder on the SFTP server. */
    path: remoteFolderSchema,
    writable: z.boolean(),
    /** The host key fingerprint shown by the test; saving pins it. Omit to keep the pinned one. */
    hostKey: z.string().regex(HOST_KEY_PATTERN).optional(),
  }),
]);
export type FilesInput = z.infer<typeof filesInputSchema>;

/** The Files connector as the API shows it; passwords and keys never leave the server. */
export const filesInfoSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('folder'), path: z.string(), writable: z.boolean() }),
  z.object({
    source: z.literal('sftp'),
    host: z.string(),
    port: z.number().int(),
    username: z.string(),
    auth: z.enum(SFTP_AUTH_METHODS),
    path: z.string(),
    writable: z.boolean(),
    /** The pinned fingerprint of the host key. */
    hostKey: z.string(),
  }),
]);
export type FilesInfo = z.infer<typeof filesInfoSchema>;

export const filesStateSchema = z.object({
  /** OUTPOST_FILES_ROOT: the mounted folders of the servers lie below it. */
  root: z.string(),
  files: filesInfoSchema.nullable(),
});

/** SFTP runs all steps; a mounted folder starts at `folder`. */
export const FILES_TEST_STEPS = ['connect', 'auth', 'folder', 'properties', 'write'] as const;
export const filesTestResultSchema = testResultSchema(FILES_TEST_STEPS).extend({
  /** SFTP: the fingerprint of the host key the server presented; null otherwise. */
  hostKey: z.string().nullable(),
});
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
