import { describe, expect, it } from 'vitest';
import { testConnection } from './manager.js';
import { parsePlayerList } from './minecraft.js';
import { RconClient } from './rcon.js';

// Runs only against a real Minecraft server; CI starts itzg/minecraft-server for it.
// OUTPOST_TEST_RCON_URL=rcon://:<password>@<host>:<port>
const url = process.env['OUTPOST_TEST_RCON_URL'];
const target = url === undefined ? undefined : parseUrl(url);

function parseUrl(value: string) {
  const parsed = new URL(value);
  return {
    host: parsed.hostname,
    port: Number(parsed.port),
    password: decodeURIComponent(parsed.password),
  };
}

describe.skipIf(target === undefined)('RCON against a real Minecraft server', () => {
  const server = target ?? { host: '', port: 0, password: '' };

  it('runs commands, one after another, and joins long replies', async () => {
    const client = await RconClient.connect(server);
    try {
      expect(parsePlayerList(await client.send('list'))).toMatchObject({ online: 0, names: [] });
      // The help text of all commands is longer than one RCON packet of 4096 bytes.
      const help = await client.send('help');
      expect(help).toContain('/advancement');
      expect(help).toContain('/xp');
      const [seed, difficulty] = await Promise.all([
        client.send('seed'),
        client.send('difficulty'),
      ]);
      expect(seed).toMatch(/Seed/);
      expect(difficulty).toMatch(/difficulty/i);
      // Chat from the panel: accepted even without players online.
      expect(typeof (await client.send('tellraw @a {"text":"Outpost test"}'))).toBe('string');
    } finally {
      client.close();
    }
  });

  it('rejects a wrong password', async () => {
    await expect(RconClient.connect({ ...server, password: 'wrong' })).rejects.toMatchObject({
      code: 'auth_failed',
    });
  });

  it('passes the connection test', async () => {
    expect((await testConnection(server)).ok).toBe(true);
  });
});
