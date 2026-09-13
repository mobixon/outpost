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
