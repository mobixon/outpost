import { appendFile, mkdtemp, open, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LogLine } from '@outpost/plugin-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LogHub, type LogSource } from './hub.js';

let folder: string;
let file: string;
let hub: LogHub | undefined;

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), 'outpost-logs-'));
  file = path.join(folder, 'latest.log');
});

afterEach(async () => {
  hub?.closeAll();
  hub = undefined;
  await rm(folder, { recursive: true, force: true });
});

const source: LogSource = {
  size: async () => (await stat(file).catch(() => undefined))?.size ?? null,
  read: async (offset, length) => {
    const handle = await open(file, 'r');
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  },
};

function start(options: { tailBytes?: number; idleMs?: number } = {}): LogHub {
  hub = new LogHub({
    sourceOf: async (serverId) => (serverId === 'survival' ? { source, pollMs: 10 } : undefined),
    ...options,
  });
  return hub;
}

const texts = (lines: LogLine[]) => lines.map((line) => line.text);

async function collect(logs: LogHub) {
  const received: LogLine[] = [];
  const stop = await logs.subscribe('survival', (lines) => received.push(...lines));
  return { received, stop };
}

describe('LogHub', () => {
  it('starts with the end of the log and follows new lines', async () => {
    await writeFile(file, '[12:00:00] [Server thread/INFO]: Starting\r\nDone\nhalf a li');
    const logs = start();
    const { received } = await collect(logs);
    expect(texts(await logs.recent('survival'))).toEqual([
      '[12:00:00] [Server thread/INFO]: Starting',
      'Done',
    ]);

    await appendFile(file, 'ne\nAlex joined the game\n');
    await vi.waitFor(() =>
      expect(texts(received)).toEqual(['half a line', 'Alex joined the game']),
    );
    const ids = (await logs.recent('survival')).map((line) => line.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('reads only the tail of a long log, from the next whole line', async () => {
    await writeFile(file, `${'x'.repeat(100)}\nsecond\nthird\n`);
    const logs = start({ tailBytes: 20 });
    expect(texts(await logs.recent('survival'))).toEqual(['second', 'third']);
  });

  it('starts over when the server replaces the log', async () => {
    await writeFile(file, 'an old line that is long enough\n');
    const logs = start();
    const { received } = await collect(logs);
    await writeFile(file, 'new start\n');
    await vi.waitFor(() => expect(texts(received)).toEqual(['new start']));
  });

  it('waits for a log that does not exist yet', async () => {
    const logs = start();
    const { received } = await collect(logs);
    expect(await logs.recent('survival')).toEqual([]);
    await writeFile(file, 'first\n');
    await vi.waitFor(() => expect(texts(received)).toEqual(['first']));
  });

  it('stops following a log nobody listens to', async () => {
    await writeFile(file, 'one\n');
    const logs = start({ idleMs: 20 });
    const { received, stop } = await collect(logs);
    stop();
    await new Promise((resolve) => setTimeout(resolve, 60));
    await appendFile(file, 'two\n');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(received).toEqual([]);
    // Opened again, the log starts from its end.
    expect(texts(await logs.recent('survival'))).toEqual(['one', 'two']);
  });

  it('refuses servers without a log', async () => {
    const logs = start();
    await expect(logs.recent('creative')).rejects.toMatchObject({
      statusCode: 409,
      code: 'capability_missing',
    });
  });
});
