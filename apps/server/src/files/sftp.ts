import { createHash, randomBytes } from 'node:crypto';
import { posix } from 'node:path';
import { HttpError, type FileEntry, type FileStat } from '@outpost/plugin-api';
import type { FilesTestResult } from '@outpost/shared';
import ssh2, { type FileEntryWithStats, type SFTPWrapper, type Stats } from 'ssh2';
import { describeProperties, MAX_FILE_BYTES, pathSegments, tooLarge } from './folder.js';

// ssh2 is CommonJS: Node finds `utils` only on the default export.
const { Client, utils } = ssh2;
type Client = InstanceType<typeof Client>;

/** Where and how to reach the files of a server over SFTP. */
export interface SftpTarget {
  host: string;
  port: number;
  username: string;
  auth: 'password' | 'key';
  /** The password or the private key. */
  secret: string;
  passphrase?: string | undefined;
  /** The server's folder on the SFTP server. */
  path: string;
  /** The pinned fingerprint of the host key; without it any key is accepted and reported. */
  hostKey?: string | undefined;
}

/** Why an SFTP session could not be opened, and the test step that failed. */
export class SftpConnectError extends Error {
  override name = 'SftpConnectError';

  constructor(
    readonly step: 'connect' | 'auth',
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The fingerprint of a host key as OpenSSH shows it, e.g. `SHA256:47DEQpj8…`. */
export function fingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

export interface SftpSession {
  client: Client;
  sftp: SFTPWrapper;
  closed: boolean;
}

const SOCKET_ERRORS: Record<string, string> = {
  ENOTFOUND: 'host_not_found',
  EAI_AGAIN: 'host_not_found',
  ECONNREFUSED: 'connection_refused',
  EHOSTUNREACH: 'host_unreachable',
  ENETUNREACH: 'host_unreachable',
  ETIMEDOUT: 'timeout',
  ECONNRESET: 'connection_closed',
};

function toConnectError(
  err: Error & { level?: string; code?: string },
  step: 'connect' | 'auth',
): SftpConnectError {
  if (err.level === 'client-authentication') {
    return new SftpConnectError('auth', 'login_failed', 'The login was refused');
  }
  if (/timed out/i.test(err.message)) {
    return new SftpConnectError(step, 'timeout', 'The server did not answer in time');
  }
  const code = err.code === undefined ? undefined : SOCKET_ERRORS[err.code];
  return new SftpConnectError(step, code ?? 'ssh_error', err.message);
}

/**
 * Opens an SFTP session. A pinned host key must match; `onHostKey` learns the key the server
 * presents either way, so that a test can show it.
 */
export function openSftp(
  target: SftpTarget,
  options: { timeoutMs?: number; onHostKey?: (fingerprint: string) => void } = {},
): Promise<SftpSession> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let step: 'connect' | 'auth' = 'connect';
    let keyRejected = false;
    let settled = false;
    const fail = (error: SftpConnectError) => {
      if (settled) return;
      settled = true;
      client.end();
      reject(error);
    };
    client.on('handshake', () => {
      step = 'auth';
    });
    client.on('ready', () => {
      client.sftp((err, sftp) => {
        if (err) {
          fail(new SftpConnectError('auth', 'sftp_unavailable', 'The server does not offer SFTP'));
          return;
        }
        settled = true;
        const session: SftpSession = { client, sftp, closed: false };
        client.on('close', () => {
          session.closed = true;
        });
        resolve(session);
      });
    });
    client.on('error', (err) => {
      fail(
        keyRejected
          ? new SftpConnectError('connect', 'host_key_mismatch', 'The host key has changed')
          : toConnectError(err, step),
      );
    });
    client.on('close', () => {
      fail(new SftpConnectError(step, 'connection_closed', 'The server closed the connection'));
    });
    try {
      client.connect({
        host: target.host,
        port: target.port,
        username: target.username,
        ...(target.auth === 'password'
          ? { password: target.secret }
          : {
              privateKey: target.secret,
              ...(target.passphrase !== undefined && { passphrase: target.passphrase }),
            }),
        readyTimeout: options.timeoutMs ?? 10_000,
        hostVerifier: (key: Buffer) => {
          const presented = fingerprint(key);
          options.onHostKey?.(presented);
          keyRejected = target.hostKey !== undefined && target.hostKey !== presented;
          return !keyRejected;
        },
      });
    } catch (err) {
      // ssh2 refuses a private key it cannot read before connecting.
      const message = err instanceof Error ? err.message : 'The private key cannot be read';
      fail(new SftpConnectError('auth', 'invalid_private_key', message));
    }
  });
}

type Done<T> = (err: Error | null | undefined, value?: T) => void;

/** Runs an SFTP call with a callback as a promise; a call that throws rejects it. */
function call<T = void>(action: (done: Done<T>) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    action((err, value) => {
      if (err) reject(err);
      else resolve(value as T);
    });
  });
}

const statusOf = (err: unknown) => (err as { code?: unknown } | null)?.code;
const NO_SUCH_FILE = 2;
const PERMISSION_DENIED = 3;

/** An SFTP error as an API error. */
function toSftpError(err: unknown): unknown {
  if (err instanceof HttpError) return err;
  if (statusOf(err) === NO_SUCH_FILE) {
    return new HttpError(404, 'file_not_found', 'No such file or directory');
  }
  if (statusOf(err) === PERMISSION_DENIED) {
    return new HttpError(502, 'files_permission_denied', 'Outpost may not access this file');
  }
  return err instanceof Error ? new HttpError(502, 'files_error', err.message) : err;
}

async function guard<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (err) {
    throw toSftpError(err);
  }
}

const isInside = (base: string, target: string) =>
  target === base || target.startsWith(base === '/' ? '/' : `${base}/`);

function toStat(stats: Stats): FileStat {
  return {
    type: stats.isFile() ? 'file' : stats.isDirectory() ? 'directory' : 'other',
    size: stats.isFile() ? stats.size : 0,
    modifiedAt: new Date(stats.mtime * 1000),
  };
}

const notAFile = () => new HttpError(400, 'not_a_file', 'Not a file');

/**
 * The folder of one game server on an SFTP server, with the same rules as a mounted folder: the
 * server resolves symbolic links, and paths that end up outside the folder are refused. Writes
 * go to a temporary file that replaces the target, atomically where the server supports
 * `posix-rename@openssh.com`.
 */
export class SftpFiles {
  constructor(
    private readonly sftp: SFTPWrapper,
    private readonly folder: string,
  ) {}

  /** The real path of the server's folder on the SFTP server; it must be a directory. */
  async location(): Promise<string> {
    const missing = (err: unknown) => {
      const mapped = toSftpError(err);
      throw mapped instanceof HttpError && mapped.code === 'file_not_found'
        ? new HttpError(502, 'folder_not_found', 'The folder does not exist on the SFTP server')
        : mapped;
    };
    // OpenSSH resolves a path whose last part does not exist, so the folder is checked as well.
    const folder = await call<string>((done) => this.sftp.realpath(this.folder, done)).catch(
      missing,
    );
    const info = await this.#stat(folder).catch(missing);
    if (!info.isDirectory()) throw new HttpError(400, 'not_a_directory', 'Not a directory');
    return folder;
  }

  async #resolve(relative: string): Promise<string> {
    const segments = pathSegments(relative);
    const folder = await this.location();
    const target = await call<string>((done) =>
      this.sftp.realpath(posix.join(folder, ...segments), done),
    );
    if (!isInside(folder, target)) {
      throw new HttpError(400, 'path_outside_folder', 'The path leads outside the server folder');
    }
    return target;
  }

  #stat(path: string): Promise<Stats> {
    return call<Stats>((done) => this.sftp.stat(path, done));
  }

  read(relative: string): Promise<Buffer> {
    return guard(async () => {
      const target = await this.#resolve(relative);
      const info = await this.#stat(target);
      if (!info.isFile()) throw notAFile();
      if (info.size > MAX_FILE_BYTES) throw tooLarge();
      return call<Buffer>((done) => this.sftp.readFile(target, done));
    });
  }

  /** Replaces or creates a file; its directory must exist. */
  write(relative: string, data: Uint8Array | string): Promise<void> {
    return guard(async () => {
      const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
      if (bytes.length > MAX_FILE_BYTES) throw tooLarge();
      const segments = pathSegments(relative);
      const name = segments.pop();
      if (name === undefined) throw notAFile();
      let target = posix.join(await this.#resolve(segments.join('/')), name);
      let current = await call<Stats>((done) => this.sftp.lstat(target, done)).catch(
        (err: unknown) => {
          if (statusOf(err) === NO_SUCH_FILE) return undefined;
          throw err;
        },
      );
      if (current?.isSymbolicLink()) {
        // Write through a link only when it points into the folder.
        target = await this.#resolve(relative);
        current = await this.#stat(target);
      }
      if (current?.isDirectory()) throw notAFile();

      const mode = current === undefined ? 0o644 : current.mode & 0o777;
      const temp = posix.join(
        posix.dirname(target),
        `.${posix.basename(target)}.${randomBytes(6).toString('hex')}.tmp`,
      );
      try {
        await call((done) => this.sftp.writeFile(temp, bytes, { flag: 'wx', mode }, done));
        // Servers may apply their umask on create; setting the mode is best effort.
        await call((done) => this.sftp.chmod(temp, mode, done)).catch(() => undefined);
        await this.#replace(temp, target, current !== undefined);
      } catch (err) {
        await call((done) => this.sftp.unlink(temp, done)).catch(() => undefined);
        throw err;
      }
    });
  }

  async #replace(temp: string, target: string, exists: boolean): Promise<void> {
    try {
      await call((done) => this.sftp.ext_openssh_rename(temp, target, done));
      return;
    } catch (err) {
      if (!(err instanceof Error && err.message.includes('does not support'))) throw err;
    }
    // Plain SFTP cannot rename over an existing file.
    if (exists) await call((done) => this.sftp.unlink(target, done));
    await call((done) => this.sftp.rename(temp, target, done));
  }

  /** null when nothing exists at the path. */
  async stat(relative: string): Promise<FileStat | null> {
    try {
      return toStat(await this.#stat(await this.#resolve(relative)));
    } catch (err) {
      const mapped = toSftpError(err);
      if (mapped instanceof HttpError && mapped.code === 'file_not_found') return null;
      throw mapped;
    }
  }

  list(relative: string): Promise<FileEntry[]> {
    return guard(async () => {
      const directory = await this.#resolve(relative);
      if (!(await this.#stat(directory)).isDirectory()) {
        throw new HttpError(400, 'not_a_directory', 'Not a directory');
      }
      const entries = await call<FileEntryWithStats[]>((done) =>
        this.sftp.readdir(directory, done),
      );
      // Symbolic links are listed as `other`.
      return entries
        .map((entry) => ({ name: entry.filename, ...toStat(entry.attrs) }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    });
  }

  /** The owner (UID) of a file, when the server tells it. */
  owner(relative: string): Promise<number | undefined> {
    return guard(async () => (await this.#stat(await this.#resolve(relative))).uid);
  }

  remove(relative: string): Promise<void> {
    return guard(async () => {
      const target = await this.#resolve(relative);
      await call((done) => this.sftp.unlink(target, done));
    });
  }
}

/**
 * The SFTP sessions of servers for modules: opened on first use, shared while the settings stay
 * the same, and closed after a while without use.
 */
export class SftpSessions {
  readonly #entries = new Map<
    string,
    { key: string; session: Promise<SftpSession>; users: number; timer?: NodeJS.Timeout }
  >();

  constructor(
    private readonly idleMs = 60_000,
    private readonly timeoutMs = 10_000,
  ) {}

  async use<T>(
    serverId: string,
    target: SftpTarget,
    action: (files: SftpFiles) => Promise<T>,
  ): Promise<T> {
    const entry = await this.#entry(serverId, target);
    entry.users += 1;
    clearTimeout(entry.timer);
    try {
      const session = await entry.session.catch((err: unknown) => {
        if (this.#entries.get(serverId) === entry) this.#entries.delete(serverId);
        throw err instanceof SftpConnectError ? new HttpError(502, err.code, err.message) : err;
      });
      return await action(new SftpFiles(session.sftp, target.path));
    } finally {
      entry.users -= 1;
      if (entry.users === 0 && this.#entries.get(serverId) === entry) {
        entry.timer = setTimeout(() => this.reset(serverId), this.idleMs);
        entry.timer.unref();
      }
    }
  }

  async #entry(serverId: string, target: SftpTarget) {
    // Compared in memory only, to notice changed settings.
    const key = JSON.stringify(target);
    const current = this.#entries.get(serverId);
    if (current?.key === key) {
      const session = await current.session.catch(() => undefined);
      if (session !== undefined && !session.closed) return current;
    }
    this.reset(serverId);
    const entry = {
      key,
      session: openSftp(target, { timeoutMs: this.timeoutMs }),
      users: 0,
      timer: undefined,
    };
    // Failures are handled by the users of the session.
    entry.session.catch(() => undefined);
    this.#entries.set(serverId, entry);
    return entry;
  }

  /** Closes the session of a server, e.g. after its settings changed. */
  reset(serverId: string): void {
    const entry = this.#entries.get(serverId);
    if (entry === undefined) return;
    this.#entries.delete(serverId);
    clearTimeout(entry.timer);
    entry.session.then(
      (session) => session.client.end(),
      () => undefined,
    );
  }

  closeAll(): void {
    for (const serverId of [...this.#entries.keys()]) this.reset(serverId);
  }
}

/**
 * Checks an SFTP connector step by step: the host answers and presents a key (the pinned one, if
 * any), the login works, the folder exists and holds `server.properties`, and — when writing is
 * wanted — new files get the owner of the server's files.
 */
export async function testSftp(
  target: SftpTarget,
  writable: boolean,
  timeoutMs = 10_000,
): Promise<FilesTestResult> {
  type Step = FilesTestResult['steps'][number];
  const step = (name: Step['step']): Step => ({ step: name, ok: null, error: null, detail: null });
  const connect = step('connect');
  const auth = step('auth');
  const location = step('folder');
  const properties = step('properties');
  const write = step('write');
  const steps = [connect, auth, location, properties, ...(writable ? [write] : [])];
  let hostKey: string | null = null;
  let current = connect;
  let session: SftpSession | undefined;
  try {
    if (
      target.auth === 'key' &&
      utils.parseKey(target.secret, target.passphrase) instanceof Error
    ) {
      current = auth;
      throw new HttpError(400, 'invalid_private_key', 'The private key cannot be read');
    }
    session = await openSftp(target, {
      timeoutMs,
      onHostKey: (key) => {
        hostKey = key;
        connect.detail = key;
      },
    });
    connect.ok = true;
    auth.ok = true;

    current = location;
    const files = new SftpFiles(session.sftp, target.path);
    const real = await files.location();
    location.ok = true;
    location.detail = real;

    current = properties;
    const text = await files.read('server.properties').catch((err: unknown) => {
      throw err instanceof HttpError && err.code === 'file_not_found'
        ? new HttpError(400, 'properties_not_found', 'No server.properties in the folder')
        : err;
    });
    properties.ok = true;
    properties.detail = describeProperties(text.toString('utf8'));

    if (writable) {
      current = write;
      const probe = `.outpost-write-test-${randomBytes(6).toString('hex')}`;
      await files.write(probe, 'ok');
      try {
        const [owner, written] = await Promise.all([
          files.owner('server.properties'),
          files.owner(probe),
        ]);
        if (owner !== undefined && written !== undefined && owner !== written) {
          write.detail = `server.properties: UID ${owner}, new files: UID ${written}`;
          throw new HttpError(400, 'owner_mismatch', 'New files get another owner');
        }
      } finally {
        await files.remove(probe).catch(() => undefined);
      }
      write.ok = true;
    }
  } catch (err) {
    if (err instanceof SftpConnectError) {
      if (err.step === 'auth') connect.ok = true;
      current = err.step === 'auth' ? auth : connect;
    }
    current.ok = false;
    current.error =
      err instanceof SftpConnectError || err instanceof HttpError ? err.code : 'internal_error';
  } finally {
    session?.client.end();
  }
  return { ok: steps.every((entry) => entry.ok === true), steps, hostKey };
}
