import { HttpError, type FileEntry, type FileStat, type PluginContext } from '@outpost/plugin-api';
import { FolderFiles } from './folder.js';
import type { SftpSessions, SftpTarget } from './sftp.js';

/** The Files connector of a server, as `ctx.files` needs it. */
export type FilesSettings =
  | { source: 'folder'; path: string; writable: boolean }
  | { source: 'sftp'; target: SftpTarget; writable: boolean };

/** What every source of files offers: a mounted folder or an SFTP server. */
interface ServerFiles {
  read(relative: string): Promise<Uint8Array>;
  write(relative: string, data: Uint8Array | string): Promise<void>;
  stat(relative: string): Promise<FileStat | null>;
  list(relative: string): Promise<FileEntry[]>;
}

/** `ctx.files` for modules: the files of a server through its Files connector. */
export function createFileAccess(
  root: string,
  settingsOf: (serverId: string) => Promise<FilesSettings | undefined>,
  sessions: SftpSessions,
): PluginContext['files'] {
  async function run<T>(
    serverId: string,
    write: boolean,
    action: (files: ServerFiles) => Promise<T>,
  ): Promise<T> {
    const settings = await settingsOf(serverId);
    if (settings === undefined) {
      throw new HttpError(409, 'capability_missing', 'The server has no file access');
    }
    if (write && !settings.writable) {
      throw new HttpError(409, 'capability_missing', 'Writing the files of this server is off');
    }
    return settings.source === 'folder'
      ? action(new FolderFiles(root, settings.path))
      : sessions.use(serverId, settings.target, action);
  }
  return {
    read: (serverId, path) => run(serverId, false, (files) => files.read(path)),
    write: (serverId, path, data) => run(serverId, true, (files) => files.write(path, data)),
    stat: (serverId, path) => run(serverId, false, (files) => files.stat(path)),
    list: (serverId, path) => run(serverId, false, (files) => files.list(path)),
  };
}
