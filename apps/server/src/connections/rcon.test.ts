import { afterEach, describe, expect, it } from 'vitest';
import { testConnection } from './manager.js';
import { decodePackets, encodePacket, RconClient, RconError } from './rcon.js';
import { closedPort, startFakeRconServer, type FakeRconServer } from './test-rcon-server.js';

const password = 'rcon-secret';
let fake: FakeRconServer | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

const start = async (reply?: Parameters<typeof startFakeRconServer>[0]['reply']) => {
  fake = await startFakeRconServer({ password, ...(reply && { reply }) });
  return fake;
};
const connect = (port: number, options: { password?: string; timeoutMs?: number } = {}) =>
  RconClient.connect({ host: '127.0.0.1', port, password, ...options });

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    return err instanceof RconError ? err.code : String(err);
  }
}

describe('RCON packets', () => {
  it('decode packets split across chunks', () => {
    const bytes = Buffer.concat([encodePacket(7, 0, 'hello'), encodePacket(8, 0, 'wörld')]);
    const first = decodePackets(bytes.subarray(0, 20));
    expect(first.packets).toEqual([{ id: 7, type: 0, body: 'hello' }]);
    const second = decodePackets(Buffer.concat([first.rest, bytes.subarray(20)]));
    expect(second.packets).toEqual([{ id: 8, type: 0, body: 'wörld' }]);
    expect(second.rest.length).toBe(0);
  });

  it('reject impossible sizes', () => {
    const bad = Buffer.alloc(12);
    bad.writeInt32LE(3, 0);
    expect(() => decodePackets(bad)).toThrow(RconError);
  });
});

describe('RconClient', () => {
  it('logs in and runs commands', async () => {
    const server = await start((command) => `ran ${command}`);
    const client = await connect(server.port);
    expect(await client.send('list')).toBe('ran list');
    expect(await client.send('say hi')).toBe('ran say hi');
    expect(server.commands).toEqual(['list', 'say hi']);
    client.close();
  });

  it('joins replies split over several packets', async () => {
    const long = 'x'.repeat(10_000);
    const server = await start(() => long);
    const client = await connect(server.port);
    expect(await client.send('help')).toBe(long);
    client.close();
  });

  it('runs concurrent commands one after another', async () => {
    const server = await start((command) => `reply to ${command}`);
    const client = await connect(server.port);
    const replies = await Promise.all(['a', 'b', 'c'].map((command) => client.send(command)));
    expect(replies).toEqual(['reply to a', 'reply to b', 'reply to c']);
    client.close();
  });

  it('waits for the reply before the next request, as a busy Minecraft needs', async () => {
    // Slow like a name Minecraft looks up at Mojang; a request sent meanwhile drops the connection.
    const server = await start(async (command) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return `slow ${command}`;
    });
    const client = await connect(server.port);
    expect(await client.send('whitelist add Someone')).toBe('slow whitelist add Someone');
    expect(await client.send('whitelist list')).toBe('slow whitelist list');
    client.close();
  });

  it('rejects a wrong password, a refused connection and a long command', async () => {
    const server = await start();
    expect(await codeOf(connect(server.port, { password: 'wrong' }))).toBe('auth_failed');
    expect(await codeOf(connect(await closedPort()))).toBe('connection_refused');

    const client = await connect(server.port);
    expect(await codeOf(client.send(`say ${'ж'.repeat(800)}`))).toBe('command_too_long');
    expect(server.commands).toEqual([]);
    client.close();
  });

  it('times out and closes the connection when the server stops answering', async () => {
    const server = await start(() => undefined);
    const client = await connect(server.port, { timeoutMs: 200 });
    expect(await codeOf(client.send('list'))).toBe('timeout');
    expect(client.closed).toBe(true);
  });

  it('fails the command when the server closes the connection', async () => {
    const server = await start((_command, drop) => {
      drop();
      return undefined;
    });
    const client = await connect(server.port);
    expect(await codeOf(client.send('stop'))).toBe('connection_closed');
  });
});

describe('testConnection', () => {
  it('reports each step', async () => {
    const server = await start(() => 'There are 0 of a max of 20 players online: ');
    const target = { host: '127.0.0.1', port: server.port, password };
    expect(await testConnection(target)).toEqual({
      ok: true,
      steps: [
        { step: 'connect', ok: true, error: null, detail: null },
        { step: 'auth', ok: true, error: null, detail: null },
        {
          step: 'command',
          ok: true,
          error: null,
          detail: 'There are 0 of a max of 20 players online:',
        },
      ],
    });
    expect((await testConnection({ ...target, password: 'wrong' })).steps).toMatchObject([
      { ok: true },
      { ok: false, error: 'auth_failed' },
      { ok: null },
    ]);
    expect((await testConnection({ ...target, port: await closedPort() })).steps).toMatchObject([
      { ok: false, error: 'connection_refused' },
      { ok: null },
      { ok: null },
    ]);
  });
});
