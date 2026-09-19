import type { GameEvent, LogLine } from '@outpost/plugin-api';
import { HttpError } from '@outpost/plugin-api';
import { describe, expect, it } from 'vitest';
import { GameEventHub, type EventLogs } from './hub.js';

/** A log that tests write to, and reset. */
function fakeLogs() {
  const listeners = new Map<string, Set<(lines: LogLine[]) => void>>();
  const resets = new Set<(serverId: string) => void>();
  let id = 0;
  const logs: EventLogs = {
    subscribe: async (serverId, listener) => {
      const set = listeners.get(serverId) ?? new Set();
      listeners.set(serverId, set);
      set.add(listener);
      return () => set.delete(listener);
    },
    onReset: (listener) => {
      resets.add(listener);
      return () => resets.delete(listener);
    },
  };
  return {
    logs,
    write: (serverId: string, ...texts: string[]) => {
      for (const listener of listeners.get(serverId) ?? []) {
        listener(texts.map((text) => ({ id: ++id, text })));
      }
    },
    listening: (serverId: string) => listeners.get(serverId)?.size ?? 0,
    /** The log is closed and its listeners are dropped, as the hub of logs does. */
    reset: (serverId: string) => {
      listeners.get(serverId)?.clear();
      for (const listener of resets) listener(serverId);
    },
  };
}

const line = (text: string) => `[12:00:00] [Server thread/INFO]: ${text}`;

describe('GameEventHub', () => {
  it('turns lines of the log into events for every listener, following the log once', async () => {
    const fake = fakeLogs();
    const hub = new GameEventHub(fake.logs, async () => true);
    const first: GameEvent[] = [];
    const second: GameEvent[] = [];
    const stopFirst = await hub.subscribe('s1', (event) => first.push(event));
    await hub.subscribe('s1', (event) => second.push(event));
    expect(fake.listening('s1')).toBe(1);

    fake.write('s1', line('Steve joined the game'), line('Done!'), line('<Steve> !top'));
    expect(first).toEqual([
      { type: 'joined', player: 'Steve' },
      { type: 'chat', player: 'Steve', message: '!top' },
    ]);
    expect(second).toEqual(first);

    stopFirst();
    fake.write('s1', line('Alex left the game'));
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(3);
  });

  it('stops following the log when nobody listens any more', async () => {
    const fake = fakeLogs();
    const hub = new GameEventHub(fake.logs, async () => true);
    const stop = await hub.subscribe('s1', () => undefined);
    expect(fake.listening('s1')).toBe(1);
    stop();
    expect(fake.listening('s1')).toBe(0);
  });

  it('follows the log again after it was reset', async () => {
    const fake = fakeLogs();
    const hub = new GameEventHub(fake.logs, async () => true);
    const seen: GameEvent[] = [];
    await hub.subscribe('s1', (event) => seen.push(event));
    fake.reset('s1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    fake.write('s1', line('Steve joined the game'));
    expect(seen).toEqual([{ type: 'joined', player: 'Steve' }]);
  });

  it('refuses servers without the capability, and survives failing listeners', async () => {
    const fake = fakeLogs();
    const denied = new GameEventHub(fake.logs, async () => false);
    await expect(denied.subscribe('s1', () => undefined)).rejects.toMatchObject({
      statusCode: 409,
    });
    await expect(denied.subscribe('s1', () => undefined)).rejects.toBeInstanceOf(HttpError);

    const hub = new GameEventHub(fake.logs, async () => true);
    const seen: GameEvent[] = [];
    await hub.subscribe('s2', () => {
      throw new Error('boom');
    });
    await hub.subscribe('s2', (event) => seen.push(event));
    fake.write('s2', line('Steve joined the game'));
    expect(seen).toHaveLength(1);
  });
});
