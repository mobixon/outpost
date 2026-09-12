import { describe, expect, it } from 'vitest';
import { parseDatabaseUrl } from './database-url.js';

describe('parseDatabaseUrl', () => {
  it.each([
    ['sqlite:///data/outpost.db', '/data/outpost.db'],
    ['sqlite://./.data/outpost.db', './.data/outpost.db'],
    ['sqlite::memory:', ':memory:'],
  ])('parses %s', (url, path) => {
    expect(parseDatabaseUrl(url)).toEqual({ dialect: 'sqlite', path });
  });

  it.each(['postgres://u:p@db:5432/outpost', 'postgresql://db/outpost'])('parses %s', (url) => {
    expect(parseDatabaseUrl(url)).toEqual({ dialect: 'postgres', url });
  });

  it.each(['sqlite:', 'sqlite://', 'mysql://db/outpost', 'outpost.db'])('rejects %j', (url) => {
    expect(() => parseDatabaseUrl(url)).toThrow(/DATABASE_URL/);
  });
});
