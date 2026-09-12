import { createConnection, type Socket } from 'node:net';

export type RconErrorCode =
  | 'connection_refused'
  | 'host_not_found'
  | 'host_unreachable'
  | 'timeout'
  | 'auth_failed'
  | 'connection_closed'
  | 'protocol_error'
  | 'command_too_long';

export class RconError extends Error {
  override name = 'RconError';

  constructor(
    readonly code: RconErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface RconPacket {
  id: number;
  type: number;
  body: string;
}

const TYPE_RESPONSE = 0;
const TYPE_COMMAND = 2;
const TYPE_AUTH_RESPONSE = 2;
const TYPE_AUTH = 3;
/**
 * A packet type Minecraft does not know: it answers with "Unknown request …". Requests are handled
 * in order, so that answer marks the end of the (possibly split) reply to the command before it.
 */
const TYPE_SENTINEL = 200;
/** Minecraft reads request packets of at most 1460 bytes: 14 bytes of header and terminators. */
export const MAX_COMMAND_BYTES = 1446;
/** Minecraft splits replies into packets of 4096 bytes; anything much larger is garbage. */
const MAX_PACKET_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

export function encodePacket(id: number, type: number, body: string): Buffer {
  const payload = Buffer.from(body, 'utf8');
  const packet = Buffer.alloc(14 + payload.length);
  packet.writeInt32LE(10 + payload.length, 0);
  packet.writeInt32LE(id, 4);
  packet.writeInt32LE(type, 8);
  payload.copy(packet, 12);
  // The body and the packet each end with a null byte; Buffer.alloc already zeroed them.
  return packet;
}

/** Splits the complete packets off the start of the buffer. */
export function decodePackets(buffer: Buffer): { packets: RconPacket[]; rest: Buffer } {
  const packets: RconPacket[] = [];
  let offset = 0;
  while (buffer.length - offset >= 4) {
    const size = buffer.readInt32LE(offset);
    if (size < 10 || size > MAX_PACKET_BYTES) {
      throw new RconError('protocol_error', `Invalid RCON packet size ${size}`);
    }
    if (buffer.length - offset < 4 + size) break;
    packets.push({
      id: buffer.readInt32LE(offset + 4),
      type: buffer.readInt32LE(offset + 8),
      body: buffer.toString('utf8', offset + 12, offset + 4 + size - 2),
    });
    offset += 4 + size;
  }
  return { packets, rest: buffer.subarray(offset) };
}

export interface RconOptions {
  host: string;
  port: number;
  password: string;
  /** For connecting, logging in and each command. */
  timeoutMs?: number;
}

function connectError(err: NodeJS.ErrnoException): RconError {
  switch (err.code) {
    case 'ECONNREFUSED':
      return new RconError('connection_refused', 'The server refused the connection', {
        cause: err,
      });
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return new RconError('host_not_found', 'The host name cannot be resolved', { cause: err });
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return new RconError('host_unreachable', 'The host cannot be reached', { cause: err });
    default:
      return new RconError('connection_closed', `Connection failed: ${err.message}`, {
        cause: err,
      });
  }
}

/**
 * A client for the RCON protocol as Minecraft implements it (the Source RCON protocol). Commands
 * run one at a time; replies split over several packets are joined. After a timeout or an error
 * the connection is closed: create a new client to continue.
 */
export class RconClient {
  readonly #options: Required<RconOptions>;
  #socket: Socket | undefined;
  #buffer: Buffer = Buffer.alloc(0);
  #nextId = 1;
  #queue: Promise<unknown> = Promise.resolve();
  #waiting: { onPacket(packet: RconPacket): void; fail(error: RconError): void } | undefined;
  #closed = false;

  private constructor(options: RconOptions) {
    this.#options = { timeoutMs: DEFAULT_TIMEOUT_MS, ...options };
  }

  /** Connects and logs in. */
  static async connect(options: RconOptions): Promise<RconClient> {
    const client = await RconClient.open(options);
    try {
      await client.login();
    } catch (err) {
      client.close();
      throw err;
    }
    return client;
  }

  /** Only connects; call `login()` before sending commands. */
  static async open(options: RconOptions): Promise<RconClient> {
    const client = new RconClient(options);
    await client.#open();
    return client;
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Runs a command and returns the reply, which is often empty. */
  send(command: string): Promise<string> {
    if (Buffer.byteLength(command, 'utf8') > MAX_COMMAND_BYTES) {
      return Promise.reject(
        new RconError(
          'command_too_long',
          `Commands can be at most ${MAX_COMMAND_BYTES} bytes long`,
        ),
      );
    }
    const run = this.#queue.then(() => this.#execute(command));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  close(): void {
    this.#closed = true;
    this.#socket?.destroy();
    this.#waiting?.fail(new RconError('connection_closed', 'The connection was closed'));
  }

  #open(): Promise<void> {
    const { host, port, timeoutMs } = this.#options;
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host, port });
      this.#socket = socket;
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new RconError('timeout', `No answer from ${host}:${port}`));
      }, timeoutMs);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        const error = connectError(err);
        reject(error);
        this.#fail(error);
      });
      socket.once('close', () => {
        this.#closed = true;
        this.#fail(new RconError('connection_closed', 'The server closed the connection'));
      });
      socket.on('data', (chunk) => this.#onData(chunk));
    });
  }

  #onData(chunk: Buffer): void {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    let decoded;
    try {
      decoded = decodePackets(this.#buffer);
    } catch (err) {
      this.#fail(err as RconError);
      this.close();
      return;
    }
    this.#buffer = decoded.rest;
    for (const packet of decoded.packets) this.#waiting?.onPacket(packet);
  }

  #fail(error: RconError): void {
    this.#waiting?.fail(error);
  }

  /** Writes packets and waits until `onPacket` calls `done`. A timeout closes the connection. */
  #request<T>(
    packets: Buffer[],
    onPacket: (packet: RconPacket, done: (value: T) => void) => void,
  ): Promise<T> {
    if (this.#closed || this.#socket === undefined) {
      return Promise.reject(new RconError('connection_closed', 'The connection is closed'));
    }
    const socket = this.#socket;
    return new Promise<T>((resolve, reject) => {
      const finish = (error: RconError | undefined, value?: T) => {
        clearTimeout(timer);
        this.#waiting = undefined;
        if (error) reject(error);
        else resolve(value as T);
      };
      const timer = setTimeout(() => {
        finish(new RconError('timeout', 'The server did not answer in time'));
        // Late packets could be taken for the reply to the next command.
        this.close();
      }, this.#options.timeoutMs);
      this.#waiting = {
        onPacket: (packet) => onPacket(packet, (value) => finish(undefined, value)),
        fail: (error) => finish(error),
      };
      for (const packet of packets) socket.write(packet);
    });
  }

  login(): Promise<void> {
    const id = this.#takeId();
    return this.#request<undefined>(
      [encodePacket(id, TYPE_AUTH, this.#options.password)],
      (packet, done) => {
        // Source servers send an empty RESPONSE_VALUE before the auth response.
        if (packet.type !== TYPE_AUTH_RESPONSE) return;
        if (packet.id === -1) {
          this.#waiting?.fail(new RconError('auth_failed', 'The RCON password is wrong'));
          return;
        }
        if (packet.id === id) done(undefined);
      },
    );
  }

  #execute(command: string): Promise<string> {
    const id = this.#takeId();
    const sentinel = this.#takeId();
    const parts: string[] = [];
    return this.#request<string>(
      [encodePacket(id, TYPE_COMMAND, command), encodePacket(sentinel, TYPE_SENTINEL, '')],
      (packet, done) => {
        if (packet.id === id && packet.type === TYPE_RESPONSE) parts.push(packet.body);
        else if (packet.id === sentinel) done(parts.join(''));
      },
    );
  }

  #takeId(): number {
    const id = this.#nextId;
    this.#nextId = this.#nextId >= 0x7fffffff ? 1 : this.#nextId + 1;
    return id;
  }
}
