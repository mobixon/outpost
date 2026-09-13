import { HttpError } from '@outpost/plugin-api';
import {
  parsePlayerList,
  stripFormatting,
  type ConnectionTestResult,
  type ServerStatus,
} from '@outpost/shared';
import { RconClient, RconError } from './rcon.js';

export interface RconTarget {
  host: string;
  port: number;
  password: string;
}

/** An RCON failure as an API error: 400 for a command that is too long, 502 otherwise. */
export function toHttpError(err: unknown): unknown {
  if (!(err instanceof RconError)) return err;
  return err.code === 'command_too_long'
    ? new HttpError(400, err.code, err.message)
    : new HttpError(502, err.code, err.message);
}

/** The status is checked with `list`, at most this often per server. */
const STATUS_TTL_MS = 10_000;

/**
 * The RCON connections of the servers: opened on the first command, kept open and replaced when
 * the settings change or the connection breaks.
 */
export class ConnectionManager {
  readonly #clients = new Map<string, { key: string; client: Promise<RconClient> }>();
  readonly #status = new Map<string, { at: number; status: Promise<ServerStatus> }>();

  constructor(
    private readonly targetOf: (serverId: string) => Promise<RconTarget | undefined>,
    private readonly timeoutMs = 10_000,
  ) {}

  /** Runs a command; throws an HttpError (409 without a connection, 502 when unreachable). */
  async send(serverId: string, command: string): Promise<string> {
    const target = await this.targetOf(serverId);
    if (target === undefined) {
      this.reset(serverId);
      throw new HttpError(409, 'capability_missing', 'The server has no connection');
    }
    try {
      const client = await this.#client(serverId, target);
      return await client.send(command);
    } catch (err) {
      throw toHttpError(err);
    }
  }

  status(serverId: string): Promise<ServerStatus> {
    const cached = this.#status.get(serverId);
    if (cached !== undefined && Date.now() - cached.at < STATUS_TTL_MS) return cached.status;
    const status = this.#checkStatus(serverId);
    this.#status.set(serverId, { at: Date.now(), status });
    return status;
  }

  /** Closes the connection of a server, e.g. after its settings changed. */
  reset(serverId: string): void {
    this.#status.delete(serverId);
    const entry = this.#clients.get(serverId);
    if (entry === undefined) return;
    this.#clients.delete(serverId);
    entry.client.then(
      (client) => client.close(),
      () => undefined,
    );
  }

  closeAll(): void {
    for (const serverId of [...this.#clients.keys()]) this.reset(serverId);
  }

  async #client(serverId: string, target: RconTarget): Promise<RconClient> {
    // Compared in memory only, to notice changed settings.
    const key = `${target.host}\0${target.port}\0${target.password}`;
    const current = this.#clients.get(serverId);
    if (current?.key === key) {
      const client = await current.client.catch(() => undefined);
      if (client !== undefined && !client.closed) return client;
    }
    this.reset(serverId);
    const client = RconClient.connect({ ...target, timeoutMs: this.timeoutMs });
    const entry = { key, client };
    this.#clients.set(serverId, entry);
    client.catch(() => {
      if (this.#clients.get(serverId) === entry) this.#clients.delete(serverId);
    });
    return client;
  }

  async #checkStatus(serverId: string): Promise<ServerStatus> {
    const checkedAt = new Date().toISOString();
    if ((await this.targetOf(serverId)) === undefined) {
      return { reachable: null, error: null, players: null, checkedAt };
    }
    try {
      const reply = await this.send(serverId, 'list');
      return { reachable: true, error: null, players: parsePlayerList(reply), checkedAt };
    } catch (err) {
      const error = err instanceof HttpError ? err.code : 'internal_error';
      return { reachable: false, error, players: null, checkedAt };
    }
  }
}

/** Tries a connection step by step without keeping it: connect, log in, run `list`. */
export async function testConnection(
  target: RconTarget,
  timeoutMs = 10_000,
): Promise<ConnectionTestResult> {
  type Step = ConnectionTestResult['steps'][number];
  const step = (name: Step['step']): Step => ({ step: name, ok: null, error: null, detail: null });
  const connect = step('connect');
  const auth = step('auth');
  const command = step('command');
  let current = connect;
  let client: RconClient | undefined;
  try {
    client = await RconClient.open({ ...target, timeoutMs });
    connect.ok = true;
    current = auth;
    await client.login();
    auth.ok = true;
    current = command;
    const reply = await client.send('list');
    command.ok = true;
    command.detail = stripFormatting(reply).trim();
  } catch (err) {
    current.ok = false;
    current.error = err instanceof RconError ? err.code : 'internal_error';
  } finally {
    client?.close();
  }
  const steps = [connect, auth, command];
  return { ok: steps.every((entry) => entry.ok === true), steps };
}
