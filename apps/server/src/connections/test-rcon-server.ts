// A fake Minecraft RCON server for tests: logs in like Minecraft, splits long replies into
// packets of 4096 bytes and answers unknown packet types with "Unknown request".
import { createServer, type Socket } from 'node:net';
import { decodePackets, encodePacket } from './rcon.js';

export interface FakeRconServer {
  port: number;
  /** Commands received after a successful login, in order. */
  commands: string[];
  close(): Promise<void>;
}

/**
 * `reply` answers a command; `undefined` makes the server stop answering (for timeouts), and
 * `drop()` closes the connection instead of answering. A promise makes the command slow: like
 * Minecraft, the server then drops the connection when another request arrives before the reply.
 */
export async function startFakeRconServer(options: {
  password: string;
  reply?: (command: string, drop: () => void) => string | undefined | Promise<string | undefined>;
}): Promise<FakeRconServer> {
  const commands: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let buffer: Buffer = Buffer.alloc(0);
    let loggedIn = false;
    let stalled = false;
    let busy = false;
    const answer = (id: number, reply: string | undefined) => {
      if (reply === undefined) {
        stalled = true;
        return;
      }
      if (socket.destroyed) return;
      let offset = 0;
      do {
        socket.write(encodePacket(id, 0, reply.slice(offset, offset + 4096)));
        offset += 4096;
      } while (offset < reply.length);
    };
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const decoded = decodePackets(buffer);
      buffer = decoded.rest;
      for (const packet of decoded.packets) {
        if (stalled) return;
        if (busy) {
          socket.destroy();
          return;
        }
        if (packet.type === 3) {
          loggedIn = packet.body === options.password;
          socket.write(encodePacket(loggedIn ? packet.id : -1, 2, ''));
        } else if (!loggedIn) {
          socket.destroy();
        } else if (packet.type === 2) {
          commands.push(packet.body);
          const reply = (options.reply ?? (() => ''))(packet.body, () => socket.destroy());
          if (reply instanceof Promise) {
            busy = true;
            void reply.then((value) => {
              busy = false;
              answer(packet.id, value);
            });
          } else {
            answer(packet.id, reply);
          }
        } else {
          socket.write(encodePacket(packet.id, 0, `Unknown request ${packet.type.toString(16)}`));
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No TCP address');
  return {
    port: address.port,
    commands,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** A local port that refuses connections. */
export async function closedPort(): Promise<number> {
  const fake = await startFakeRconServer({ password: 'x' });
  await fake.close();
  return fake.port;
}
