import { HttpError, type FileEntry, type FileStat, type PluginContext } from '@outpost/plugin-api';
import { FolderFiles } from './folder.js';
import type { SftpSessions, SftpTarget } from './sftp.js';

/** The Files connector of a server, as reading and writing its files needs it. */
export type FilesSettings =
  | { source: 'folder'; path: string; writable: boolean }
  | { source: 'sftp'; target: SftpTarget; writable: boolean };

/** What every source of files offers: a mounted folder or an SFTP server. */
export interface ServerFiles {
  read(relative: string): Promise<Uint8Array>;
  write(relative: string, data: Uint8Array | string): Promise<void>;
  stat(relative: string): Promise<FileStat | null>;
  list(relative: string): Promise<FileEntry[]>;
  readRange(relative: string, offset: number, length: number): Promise<Uint8Array>;
}

/** The files of the servers through their Files connectors, for modules and the core. */
export class FileAccess {
  constructor(
    private readonly root: string,
    private readonly settingsOf: (serverId: string) => Promise<FilesSettings | undefined>,
    private readonly sessions: SftpSessions,
  ) {}

  /** Runs `action` with the files of a server; `write` needs writing to be allowed. */
  async run<T>(
    serverId: string,
    write: boolean,
    action: (files: ServerFiles) => Promise<T>,
  ): Promise<T> {
    const settings = await this.settingsOf(serverId);
    if (settings === undefined) {
      throw new HttpError(409, 'capability_missing', 'The server has no file access');
    }
    if (write && !settings.writable) {
      throw new HttpError(409, 'capability_missing', 'Writing the files of this server is off');
    }
    return settings.source === 'folder'
      ? action(new FolderFiles(this.root, settings.path))
      : this.sessions.use(serverId, settings.target, action);
  }

  /** `ctx.files` for modules. */
  api(): PluginContext['files'] {
    return {
      read: (serverId, path) => this.run(serverId, false, (files) => files.read(path)),
      write: (serverId, path, data) => this.run(serverId, true, (files) => files.write(path, data)),
      stat: (serverId, path) => this.run(serverId, false, (files) => files.stat(path)),
      list: (serverId, path) => this.run(serverId, false, (files) => files.list(path)),
    };
  }
}
