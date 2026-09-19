import { TextDecoder } from 'node:util';
import { HttpError, type LogLine } from '@outpost/plugin-api';

/** The log file of one server: its size, and bytes from an offset. */
export interface LogSource {
  /** The size of the file; null while it does not exist. */
  size(): Promise<number | null>;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface LogHubOptions {
  /** The log of a server and how often to look at it; undefined without `logs.stream`. */
  sourceOf(serverId: string): Promise<{ source: LogSource; pollMs: number } | undefined>;
  /** Lines kept per server. */
  keep?: number;
  /** How much of the end of the file is read when the log of a server is opened. */
  tailBytes?: number;
  /** The log of a server is closed after this long without listeners. */
  idleMs?: number;
  onError?(serverId: string, err: unknown): void;
}

/** Longer lines are cut, so that a runaway line cannot fill the memory. */
const MAX_LINE_LENGTH = 8192;
/** At most this much is read per look; a burst is spread over several looks. */
const MAX_READ_BYTES = 256 * 1024;

interface ServerLog {
  source: LogSource;
  pollMs: number;
  lines: LogLine[];
  listeners: Set<(lines: LogLine[]) => void>;
  offset: number;
  partial: string;
  decoder: TextDecoder;
  timer?: NodeJS.Timeout;
  idleTimer?: NodeJS.Timeout;
  closed: boolean;
}

/**
 * The logs of the servers for modules. The log file of a server is followed while somebody listens
 * or asked for its recent lines a moment ago, by looking at its size every `pollMs`. A file that
 * got smaller was replaced — Minecraft starts a new `latest.log` on every start — and is read from
 * its beginning.
 */
export class LogHub {
  readonly #logs = new Map<string, Promise<ServerLog>>();
  readonly #resetListeners = new Set<(serverId: string) => void>();
  readonly #keep: number;
  readonly #tailBytes: number;
  readonly #idleMs: number;
  #nextId = 1;

  constructor(private readonly options: LogHubOptions) {
    this.#keep = options.keep ?? 1000;
    this.#tailBytes = options.tailBytes ?? 64 * 1024;
    this.#idleMs = options.idleMs ?? 30_000;
  }

  async recent(serverId: string): Promise<LogLine[]> {
    const log = await this.#open(serverId);
    this.#closeWhenIdle(serverId, log);
    return [...log.lines];
  }

  async subscribe(serverId: string, listener: (lines: LogLine[]) => void): Promise<() => void> {
    const log = await this.#open(serverId);
    log.listeners.add(listener);
    clearTimeout(log.idleTimer);
    return () => {
      log.listeners.delete(listener);
      this.#closeWhenIdle(serverId, log);
    };
  }

  /**
   * Stops following the log of a server, e.g. after its connector changed. The listeners of the
   * log are dropped; `onReset` tells those who want to listen again.
   */
  reset(serverId: string): void {
    const log = this.#logs.get(serverId);
    this.#logs.delete(serverId);
    log?.then(
      (entry) => this.#close(entry),
      () => undefined,
    );
    for (const listener of this.#resetListeners) listener(serverId);
  }

  /** Calls `listener` whenever the log of a server is reset; returns a function that stops. */
  onReset(listener: (serverId: string) => void): () => void {
    this.#resetListeners.add(listener);
    return () => {
      this.#resetListeners.delete(listener);
    };
  }

  closeAll(): void {
    this.#resetListeners.clear();
    for (const serverId of [...this.#logs.keys()]) this.reset(serverId);
  }

  #open(serverId: string): Promise<ServerLog> {
    const current = this.#logs.get(serverId);
    if (current !== undefined) return current;
    const log = this.#start(serverId);
    this.#logs.set(serverId, log);
    log.catch(() => {
      if (this.#logs.get(serverId) === log) this.#logs.delete(serverId);
    });
    return log;
  }

  async #start(serverId: string): Promise<ServerLog> {
    const found = await this.options.sourceOf(serverId);
    if (found === undefined) {
      throw new HttpError(409, 'capability_missing', 'The server has no log to follow');
    }
    const log: ServerLog = {
      source: found.source,
      pollMs: found.pollMs,
      lines: [],
      listeners: new Set(),
      offset: 0,
      partial: '',
      decoder: new TextDecoder(),
      closed: false,
    };
    try {
      const size = await log.source.size();
      if (size !== null && size > 0) {
        const start = Math.max(0, size - this.#tailBytes);
        const bytes = await log.source.read(start, size - start);
        log.offset = start + bytes.length;
        const texts = this.#take(log, bytes);
        // Reading from the middle of the file starts in the middle of a line.
        this.#append(log, start > 0 ? texts.slice(1) : texts);
      }
    } catch (err) {
      this.options.onError?.(serverId, err);
    }
    this.#schedule(serverId, log);
    return log;
  }

  #schedule(serverId: string, log: ServerLog): void {
    if (log.closed) return;
    log.timer = setTimeout(() => {
      void this.#poll(serverId, log).finally(() => this.#schedule(serverId, log));
    }, log.pollMs);
    log.timer.unref();
  }

  async #poll(serverId: string, log: ServerLog): Promise<void> {
    try {
      const size = await log.source.size();
      if (size === null || size < log.offset) {
        // No file (the server has not written one yet) or a new, shorter file: start over.
        log.offset = 0;
        log.partial = '';
        log.decoder = new TextDecoder();
      }
      if (size === null || size === log.offset || log.closed) return;
      const bytes = await log.source.read(log.offset, Math.min(size - log.offset, MAX_READ_BYTES));
      log.offset += bytes.length;
      this.#append(log, this.#take(log, bytes));
    } catch (err) {
      this.options.onError?.(serverId, err);
    }
  }

  /** Complete lines from new bytes; the rest of the last line waits for its end. */
  #take(log: ServerLog, bytes: Uint8Array): string[] {
    const parts = (log.partial + log.decoder.decode(bytes, { stream: true })).split('\n');
    log.partial = parts.pop() ?? '';
    if (log.partial.length > MAX_LINE_LENGTH) {
      parts.push(log.partial);
      log.partial = '';
    }
    return parts.map((line) => line.replace(/\r$/, '').slice(0, MAX_LINE_LENGTH));
  }

  #append(log: ServerLog, texts: string[]): void {
    if (texts.length === 0) return;
    const lines = texts.map((text) => ({ id: this.#nextId++, text }));
    log.lines.push(...lines);
    if (log.lines.length > this.#keep) log.lines.splice(0, log.lines.length - this.#keep);
    for (const listener of log.listeners) {
      try {
        listener(lines);
      } catch {
        // A failing listener must not stop the others.
      }
    }
  }

  #closeWhenIdle(serverId: string, log: ServerLog): void {
    if (log.listeners.size > 0 || log.closed) return;
    clearTimeout(log.idleTimer);
    log.idleTimer = setTimeout(() => {
      if (log.listeners.size > 0) return;
      void this.#logs.get(serverId)?.then((current) => {
        if (current === log) this.reset(serverId);
      });
    }, this.#idleMs);
    log.idleTimer.unref();
  }

  #close(log: ServerLog): void {
    log.closed = true;
    clearTimeout(log.timer);
    clearTimeout(log.idleTimer);
    log.listeners.clear();
  }
}
