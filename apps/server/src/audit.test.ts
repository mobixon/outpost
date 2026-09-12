import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditLog } from './audit.js';
import { createDatabase, type Database } from './db/connection.js';
import { CORE_SCOPE, coreMigrations } from './db/core-migrations.js';
import { runMigrations } from './db/migrator.js';

const silent = { info: () => {}, warn: () => {}, error: () => {} };
const DAY_MS = 24 * 60 * 60_000;

let database: Database;
let audit: AuditLog;

beforeEach(async () => {
  database = createDatabase('sqlite::memory:');
  await runMigrations(database.db, database.dialect, CORE_SCOPE, coreMigrations, silent);
  audit = new AuditLog(database.db, silent as never);
});

afterEach(async () => {
  vi.useRealTimers();
  await database.db.destroy();
});

describe('AuditLog', () => {
  it('filters by action prefix and pages through entries, newest first', async () => {
    for (const action of ['auth.login', 'server.created', 'server.member_added', 'auth.logout']) {
      await audit.record({ action, details: { action } });
    }
    const servers = await audit.page({ action: 'server.', limit: 10 });
    expect(servers.entries.map((entry) => entry.action).sort()).toEqual([
      'server.created',
      'server.member_added',
    ]);
    expect(servers.entries[0]?.details).toMatchObject({ action: expect.any(String) });

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await audit.page({ limit: 3, ...(cursor !== undefined && { cursor }) });
      seen.push(...page.entries.map((entry) => entry.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    expect(new Set(seen).size).toBe(4);
  });

  it('deletes entries older than the retention period', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await audit.record({ action: 'auth.login' });
    vi.setSystemTime(Date.now() + 100 * DAY_MS);
    await audit.record({ action: 'auth.logout' });
    vi.setSystemTime(Date.now() + 90 * DAY_MS);

    await audit.prune(0);
    expect((await audit.page({ limit: 10 })).entries).toHaveLength(2);
    await audit.prune(180);
    expect((await audit.page({ limit: 10 })).entries.map((entry) => entry.action)).toEqual([
      'auth.logout',
    ]);
  });
});
