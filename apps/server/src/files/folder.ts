import { randomBytes } from 'node:crypto';
import type { Stats } from 'node:fs';
import {
  chmod,
  lstat,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { HttpError, type FileEntry, type FileStat } from '@outpost/plugin-api';
import type { FilesTestResult } from '@outpost/shared';

/** Files larger than this are neither read nor written through Outpost. */
export const MAX_FILE_BYTES = 32 * 1024 * 1024;

const errnoOf = (err: unknown): string | undefined =>
  err instanceof Error && 'code' in err && typeof err.code === 'string' ? err.code : undefined;

/** A file system error as an API error; other errors are returned unchanged. */
export function toFilesError(err: unknown): unknown {
  if (err instanceof HttpError) return err;
  switch (errnoOf(err)) {
    case 'ENOENT':
      return new HttpError(404, 'file_not_found', 'No such file or directory');
    case 'ENOTDIR':
      return new HttpError(400, 'not_a_directory', 'Not a directory');
    case 'EISDIR':
      return new HttpError(400, 'not_a_file', 'Not a file');
    case 'EACCES':
    case 'EPERM':
      return new HttpError(502, 'files_permission_denied', 'Outpost may not access this file');
    case 'EROFS':
      return new HttpError(502, 'files_read_only', 'The folder is mounted read-only');
    default:
      return err;
  }
}

async function guard<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (err) {
    throw toFilesError(err);
  }
}

export const tooLarge = () =>
  new HttpError(
    413,
    'file_too_large',
    `Files over ${MAX_FILE_BYTES / 1024 / 1024} MiB are refused`,
  );

/**
 * The segments of a path relative to a server folder. Absolute paths, `..` and backslashes are
 * rejected, so that a path alone can never point outside the folder.
 */
export function pathSegments(relative: string): string[] {
  const invalid = () =>
    new HttpError(400, 'invalid_path', 'Give a path inside the folder of the server');
  if (relative.startsWith('/') || /[\0\\]/.test(relative)) throw invalid();
  const segments = relative.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.includes('..')) throw invalid();
  return segments;
}

const isInside = (base: string, target: string) =>
  target === base || target.startsWith(`${base}${path.sep}`);

function toStat(info: Stats): FileStat {
  return {
    type: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other',
    size: info.isFile() ? info.size : 0,
    modifiedAt: info.mtime,
  };
}

/**
 * The folder of one game server below the files root. Symbolic links are followed only while they
 * stay inside the folder, and writes replace files atomically, so that the game server never reads
 * a half-written file.
 */
export class FolderFiles {
  /** `folder` is relative to `root`, e.g. `survival`. */
  constructor(
    private readonly root: string,
    private readonly folder: string,
  ) {}

  /** The real path of the server's folder; it must exist and lie inside the root. */
  async location(): Promise<string> {
    const missing = (code: string, message: string) => (err: unknown) => {
      throw errnoOf(err) === 'ENOENT' ? new HttpError(502, code, message) : toFilesError(err);
    };
    const root = await realpath(this.root).catch(
      missing('files_root_missing', `The files root ${this.root} does not exist`),
    );
    const folder = await realpath(path.join(root, ...pathSegments(this.folder))).catch(
      missing('folder_not_found', 'The folder of the server does not exist: is it mounted?'),
    );
    if (!isInside(root, folder) || folder === root) {
      throw new HttpError(502, 'folder_outside_root', 'The folder leads outside the files root');
    }
    return folder;
  }

  async #resolve(relative: string): Promise<string> {
    const segments = pathSegments(relative);
    const folder = await this.location();
    const target = await realpath(path.join(folder, ...segments));
    if (!isInside(folder, target)) {
      throw new HttpError(400, 'path_outside_folder', 'The path leads outside the server folder');
    }
    return target;
  }

  read(relative: string): Promise<Buffer> {
    return guard(async () => {
      const target = await this.#resolve(relative);
      const info = await stat(target);
      if (!info.isFile()) throw new HttpError(400, 'not_a_file', 'Not a file');
      if (info.size > MAX_FILE_BYTES) throw tooLarge();
      return readFile(target);
    });
  }

  /** Replaces or creates a file; its directory must exist. */
  write(relative: string, data: Uint8Array | string): Promise<void> {
    return guard(async () => {
      const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
      if (bytes.length > MAX_FILE_BYTES) throw tooLarge();
      const segments = pathSegments(relative);
      const name = segments.pop();
      if (name === undefined) throw new HttpError(400, 'not_a_file', 'Not a file');
      let target = path.join(await this.#resolve(segments.join('/')), name);
      let current = await lstat(target).catch((err: unknown) => {
        if (errnoOf(err) === 'ENOENT') return undefined;
        throw err;
      });
      if (current?.isSymbolicLink()) {
        // Write through a link only when it points into the folder.
        target = await this.#resolve(relative);
        current = await stat(target);
      }
      if (current?.isDirectory()) throw new HttpError(400, 'not_a_file', 'Not a file');

      const temp = path.join(
        path.dirname(target),
        `.${path.basename(target)}.${randomBytes(6).toString('hex')}.tmp`,
      );
      try {
        await writeFile(temp, bytes, { flag: 'wx' });
        await chmod(temp, current === undefined ? 0o644 : current.mode & 0o777);
        await rename(temp, target);
      } catch (err) {
        await rm(temp, { force: true });
        throw err;
      }
    });
  }

  /** null when nothing exists at the path. */
  async stat(relative: string): Promise<FileStat | null> {
    try {
      return toStat(await stat(await this.#resolve(relative)));
    } catch (err) {
      if (errnoOf(err) === 'ENOENT') return null;
      throw toFilesError(err);
    }
  }

  list(relative: string): Promise<FileEntry[]> {
    return guard(async () => {
      const directory = await this.#resolve(relative);
      const entries: FileEntry[] = [];
      for (const entry of await readdir(directory)) {
        // Symbolic links are listed as `other`; an entry removed meanwhile is skipped.
        const info = await lstat(path.join(directory, entry)).catch(() => undefined);
        if (info !== undefined) entries.push({ name: entry, ...toStat(info) });
      }
      return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    });
  }
}

/** `level-name` and `online-mode` from `server.properties`, to show which server was found. */
export function describeProperties(text: string): string | null {
  const wanted = ['level-name', 'online-mode'];
  const found = text
    .split(/\r?\n/)
    .map((line) => /^([a-z.-]+)=(.*)$/.exec(line.trim()))
    .filter((match) => match !== null && wanted.includes(match[1] ?? ''))
    .map((match) => `${match?.[1]}=${match?.[2]}`);
  return found.length > 0 ? found.join(', ') : null;
}

/**
 * Checks a server folder step by step: it exists, it holds `server.properties`, and — when
 * writing is wanted — Outpost can write there as the owner of the files. Atomic writes replace
 * files, so files written by another user would change their owner.
 */
export async function testFolder(
  root: string,
  folder: string,
  writable: boolean,
): Promise<FilesTestResult> {
  type Step = FilesTestResult['steps'][number];
  const step = (name: Step['step']): Step => ({ step: name, ok: null, error: null, detail: null });
  const location = step('folder');
  const properties = step('properties');
  const write = step('write');
  const steps = writable ? [location, properties, write] : [location, properties];
  let current = location;
  try {
    const files = new FolderFiles(root, folder);
    const real = await files.location();
    if (!(await stat(real)).isDirectory()) {
      throw new HttpError(400, 'not_a_directory', 'Not a directory');
    }
    location.ok = true;
    location.detail = real;

    current = properties;
    const text = await files.read('server.properties').catch((err: unknown) => {
      const mapped = toFilesError(err);
      throw mapped instanceof HttpError && mapped.code === 'file_not_found'
        ? new HttpError(400, 'properties_not_found', 'No server.properties in the folder')
        : mapped;
    });
    properties.ok = true;
    properties.detail = describeProperties(text.toString('utf8'));

    if (writable) {
      current = write;
      const owner = (await stat(path.join(real, 'server.properties'))).uid;
      const uid = process.getuid?.();
      if (uid !== undefined && owner !== uid) {
        write.detail = `server.properties: UID ${owner}, Outpost: UID ${uid}`;
        throw new HttpError(400, 'owner_mismatch', 'Outpost runs as another user than the files');
      }
      const probe = `.outpost-write-test-${randomBytes(6).toString('hex')}`;
      await files.write(probe, 'ok');
      await rm(path.join(real, probe), { force: true });
      write.ok = true;
    }
  } catch (err) {
    const mapped = toFilesError(err);
    current.ok = false;
    current.error = mapped instanceof HttpError ? mapped.code : 'internal_error';
  }
  return { ok: steps.every((entry) => entry.ok === true), steps, hostKey: null };
}
