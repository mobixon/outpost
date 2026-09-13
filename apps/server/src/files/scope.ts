import { HttpError, type FileScopes, type PluginContext } from '@outpost/plugin-api';
import { pathSegments } from './folder.js';

/** A file scope split into names: patterns for one name each, or `**` for any number. */
type Pattern = readonly (RegExp | '**')[];

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(scope: string): Pattern {
  return scope
    .split('/')
    .map((segment) =>
      segment === '**' ? '**' : new RegExp(`^${segment.split('*').map(escapeRegExp).join('.*')}$`),
    );
}

/** Whether the pattern matches the whole path. */
function matches(pattern: Pattern, path: readonly string[]): boolean {
  const [head, ...rest] = pattern;
  if (head === undefined) return path.length === 0;
  if (head === '**') {
    for (let skip = 0; skip <= path.length; skip++) {
      if (matches(rest, path.slice(skip))) return true;
    }
    return false;
  }
  const [name, ...below] = path;
  return name !== undefined && head.test(name) && matches(rest, below);
}

/** Whether the pattern matches something inside the folder at the path. */
function reachesInto(pattern: Pattern, path: readonly string[]): boolean {
  const [head, ...rest] = pattern;
  if (head === undefined) return false;
  if (head === '**') return true;
  const [name, ...below] = path;
  return name === undefined || (head.test(name) && reachesInto(rest, below));
}

/**
 * `ctx.files` of one module, limited to the files it declares (see `FileScopes`): other paths are
 * refused with 403 before the files are touched. Folders on the way to declared files can be
 * listed and statted; listings show only what the module may use.
 */
export function scopedFiles(
  pluginId: string,
  scopes: FileScopes | undefined,
  files: PluginContext['files'],
): PluginContext['files'] {
  const writable = (scopes?.write ?? []).map(compile);
  const readable = [...(scopes?.read ?? []).map(compile), ...writable];
  const canRead = (path: readonly string[]) => readable.some((pattern) => matches(pattern, path));
  const canOpen = (path: readonly string[]) =>
    readable.some((pattern) => reachesInto(pattern, path));
  const check = (allowed: boolean, access: 'read' | 'write', path: string) => {
    if (!allowed) {
      throw new HttpError(
        403,
        'file_out_of_scope',
        `The module ${pluginId} does not declare ${access} access to "${path}"`,
      );
    }
  };
  return {
    read: async (serverId, path) => {
      check(canRead(pathSegments(path)), 'read', path);
      return await files.read(serverId, path);
    },
    write: async (serverId, path, data) => {
      const segments = pathSegments(path);
      check(
        writable.some((pattern) => matches(pattern, segments)),
        'write',
        path,
      );
      await files.write(serverId, path, data);
    },
    stat: async (serverId, path) => {
      const segments = pathSegments(path);
      check(canRead(segments) || canOpen(segments), 'read', path);
      return await files.stat(serverId, path);
    },
    list: async (serverId, path) => {
      const segments = pathSegments(path);
      check(canOpen(segments), 'read', path);
      const entries = await files.list(serverId, path);
      return entries.filter((entry) => {
        const child = [...segments, entry.name];
        return canRead(child) || (entry.type === 'directory' && canOpen(child));
      });
    },
  };
}
