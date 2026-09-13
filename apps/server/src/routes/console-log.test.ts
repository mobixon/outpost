import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import consolePlugin from '@outpost/plugin-console/server';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUserWithInvitation, get, send, setUpAdmin, startTestApp } from '../test-helpers.js';

interface ServerSentEvent {
  event: string;
  id?: string;
  data: unknown;
}

/** Reads server-sent events from a streamed response. */
class EventReader {
  readonly events: ServerSentEvent[] = [];
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly #decoder = new TextDecoder();
  #buffer = '';

  constructor(response: Response) {
    if (response.body === null) throw new Error('No body');
    this.#reader = response.body.getReader();
  }

  /** Reads until `done` is true for the events so far, or fails after a while. */
  async until(done: (events: ServerSentEvent[]) => boolean, timeoutMs = 8000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!done(this.events)) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`No such event yet: ${JSON.stringify(this.events)}`);
      const chunk = await Promise.race([
        this.#reader.read(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timed out')), left)),
      ]);
      if (chunk.done) throw new Error('The stream ended');
      this.#buffer += this.#decoder.decode(chunk.value, { stream: true });
      const blocks = this.#buffer.split('\n\n');
      this.#buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        const fields = new Map<string, string>();
        for (const line of block.split('\n')) {
          const colon = line.indexOf(': ');
          if (colon > 0) fields.set(line.slice(0, colon), line.slice(colon + 2));
        }
        const data = fields.get('data');
        if (data === undefined) continue;
        this.events.push({
          event: fields.get('event') ?? 'message',
          ...(fields.has('id') && { id: fields.get('id') }),
          data: JSON.parse(data),
        });
      }
    }
  }
}

const texts = (events: ServerSentEvent[]) =>
  events
    .filter((event) => event.event === 'lines')
    .flatMap((event) => (event.data as { text: string }[]).map((line) => line.text));

let root: string;
let logFile: string;
let app: FastifyInstance | undefined;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'outpost-console-log-'));
  await mkdir(path.join(root, 'survival', 'logs'), { recursive: true });
  await writeFile(path.join(root, 'survival', 'server.properties'), 'level-name=world\n');
  logFile = path.join(root, 'survival', 'logs', 'latest.log');
  await writeFile(logFile, '[12:00:00] [Server thread/INFO]: Starting\nDone\n');
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  await rm(root, { recursive: true, force: true });
});

async function setUp(files: boolean) {
  app = await startTestApp({
    env: { OUTPOST_REQUIRE_2FA_FOR_ADMINS: 'false', OUTPOST_FILES_ROOT: root },
    plugins: [consolePlugin],
  });
  const server = app;
  const admin = await setUpAdmin(server);
  const created = await send(server, 'POST', '/api/v1/servers', {
    cookie: admin,
    body: { name: 'Survival', slug: 'survival', game: 'minecraft-java' },
  });
  const serverId = created.json<{ id: string }>().id;
  if (files) {
    await send(server, 'PUT', `/api/v1/servers/${serverId}/files`, {
      cookie: admin,
      body: { source: 'folder', path: 'survival', writable: false },
    });
  }
  const member = (username: string, role: string) =>
    createUserWithInvitation(server, admin, username, { serverId, role });
  return { server, admin, serverId, member };
}

describe('the live log of the console', { timeout: 20_000 }, () => {
  it('streams the recent lines and then the new ones', async () => {
    const { server, serverId, member } = await setUp(true);
    const [moderator, viewer] = await Promise.all([
      member('the-moderator', 'moderator'),
      member('the-viewer', 'viewer'),
    ]);
    const url = `/api/v1/servers/${serverId}/plugins/outpost.console/log`;

    // The log shows the chat and IP addresses, so viewers do not get it.
    expect((await get(server, url, viewer.cookie)).json()).toMatchObject({
      error: { code: 'forbidden' },
    });

    const address = await server.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();
    try {
      const response = await fetch(`${address}${url}`, {
        headers: { cookie: moderator.cookie },
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(response.headers.get('x-accel-buffering')).toBe('no');

      const stream = new EventReader(response);
      await stream.until((events) => events.some((event) => event.event === 'ready'));
      expect(texts(stream.events)).toEqual(['[12:00:00] [Server thread/INFO]: Starting', 'Done']);

      await appendFile(logFile, 'Alex joined the game\n');
      await stream.until((events) => texts(events).includes('Alex joined the game'));
      const last = stream.events.filter((event) => event.event === 'lines').at(-1);
      expect(Number(last?.id)).toBeGreaterThan(0);

      // A browser that reconnects gets only the lines it missed.
      const again = await fetch(`${address}${url}`, {
        headers: { cookie: moderator.cookie, 'last-event-id': last?.id ?? '' },
        signal: controller.signal,
      });
      const resumed = new EventReader(again);
      await resumed.until((events) => events.some((event) => event.event === 'ready'));
      expect(texts(resumed.events)).toEqual([]);
    } finally {
      controller.abort();
    }
  });

  it('needs the files of the server', async () => {
    const { server, admin, serverId } = await setUp(false);
    expect(
      (await get(server, `/api/v1/servers/${serverId}/plugins/outpost.console/log`, admin)).json(),
    ).toMatchObject({ error: { code: 'capability_missing' } });
  });

  it('shares the general rate limit', async () => {
    const { server, admin, serverId } = await setUp(false);
    const hit = () => get(server, `/api/v1/servers/${serverId}/plugins/outpost.console/log`, admin);
    const first = await hit();
    expect(first.headers['x-ratelimit-limit']).toBe('600');
    const remaining = Number(first.headers['x-ratelimit-remaining']);
    for (let i = 0; i < remaining; i++) await hit();
    const limited = await hit();
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: 'rate_limited' } });
  });
});
