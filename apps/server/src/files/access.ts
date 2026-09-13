import { HttpError, type PluginContext } from '@outpost/plugin-api';
import { FolderFiles } from './folder.js';

/** The Files connector of a server: its folder below the files root. */
export interface FilesSettings {
  path: string;
  writable: boolean;
}

/** `ctx.files` for modules: the files of a server through its Files connector. */
export function createFileAccess(
  root: string,
  settingsOf: (serverId: string) => Promise<FilesSettings | undefined>,
): PluginContext['files'] {
  async function folder(serverId: string, write: boolean): Promise<FolderFiles> {
    const settings = await settingsOf(serverId);
    if (settings === undefined) {
      throw new HttpError(409, 'capability_missing', 'The server has no file access');
    }
    if (write && !settings.writable) {
      throw new HttpError(409, 'capability_missing', 'Writing the files of this server is off');
    }
    return new FolderFiles(root, settings.path);
  }
  return {
    read: async (serverId, path) => (await folder(serverId, false)).read(path),
    write: async (serverId, path, data) => (await folder(serverId, true)).write(path, data),
    stat: async (serverId, path) => (await folder(serverId, false)).stat(path),
    list: async (serverId, path) => (await folder(serverId, false)).list(path),
  };
}
