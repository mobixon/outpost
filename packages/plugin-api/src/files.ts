/** What a path of a game server is. */
export interface FileStat {
  type: 'file' | 'directory' | 'other';
  /** Size in bytes; 0 for anything but files. */
  size: number;
  modifiedAt: Date;
}

/** An entry of a directory of a game server. */
export interface FileEntry extends FileStat {
  name: string;
}

/**
 * The files of a game server a module may use through `ctx.files`, as paths relative to the
 * server's folder: `*` stands for any part of one name (`world/stats/*.json`) and `**` for any
 * number of folders (`logs/**`). Paths in `write` may also be read. A module without scopes cannot
 * use `ctx.files`.
 */
export interface FileScopes {
  read?: readonly string[];
  write?: readonly string[];
}
