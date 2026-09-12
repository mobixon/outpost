import { ConfigError } from '../config.js';

export type DatabaseTarget =
  { dialect: 'sqlite'; path: string } | { dialect: 'postgres'; url: string };

/**
 * Parses `DATABASE_URL`:
 * - `sqlite:///data/outpost.db` — absolute path,
 * - `sqlite://./.data/outpost.db` — path relative to the working directory,
 * - `sqlite::memory:` — in-memory database (tests),
 * - `postgres://user:password@host:5432/db` or `postgresql://…`.
 */
export function parseDatabaseUrl(url: string): DatabaseTarget {
  if (url.startsWith('sqlite:')) {
    const path = url.slice('sqlite:'.length).replace(/^\/\//, '');
    if (path === '') throw new ConfigError('DATABASE_URL: the SQLite URL has no file path');
    return { dialect: 'sqlite', path };
  }
  if (/^postgres(?:ql)?:\/\//.test(url)) return { dialect: 'postgres', url };
  throw new ConfigError('DATABASE_URL: expected a sqlite: or postgres:// URL');
}
