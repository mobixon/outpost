import { HttpError, type GameEvent, type GameEvents, type LogLine } from '@outpost/plugin-api';
import { parseLogLine } from '@outpost/shared';

/** The log of a server, as far as the events need it. */
export interface EventLogs {
  subscribe(serverId: string, listener: (lines: LogLine[]) => void): Promise<() => void>;
  /** Calls the listener whenever the log of a server is reset; returns a function that stops. */
  onReset(listener: (serverId: string) => void): () => void;
}

interface Source {
  listeners: Set<(event: GameEvent) => void>;
  /** Stops following the log; undefined until it is followed. */
  stop?: () => void;
  /** Bumped when the log is followed anew, so that a late answer of an old attempt is dropped. */
  generation: number;
}

/**
 * What players do on the servers, for modules: reads the lines of the log once per server, however
 * many modules listen, and follows the log again after it was reset.
 */
export class GameEventHub implements GameEvents {
  readonly #sources = new Map<string, Source>();
  readonly #stopResets: () => void;

  constructor(
    private readonly logs: EventLogs,
    private readonly hasCapability: (serverId: string) => Promise<boolean>,
  ) {
    this.#stopResets = logs.onReset((serverId) => {
      const source = this.#sources.get(serverId);
      if (source === undefined || source.listeners.size === 0) return;
      source.stop = undefined;
      // The connector may be gone: then there is nothing to follow until a module subscribes anew.
      void this.#follow(serverId, source).catch(() => {
        if (this.#sources.get(serverId) === source) this.#sources.delete(serverId);
      });
    });
  }

  async subscribe(serverId: string, listener: (event: GameEvent) => void): Promise<() => void> {
    if (!(await this.hasCapability(serverId))) {
      throw new HttpError(409, 'capability_missing', 'The server has no game events to follow');
    }
    let source = this.#sources.get(serverId);
    if (source === undefined) {
      source = { listeners: new Set(), generation: 0 };
      this.#sources.set(serverId, source);
      try {
        await this.#follow(serverId, source);
      } catch (err) {
        this.#sources.delete(serverId);
        throw err;
      }
    }
    const current = source;
    current.listeners.add(listener);
    return () => {
      current.listeners.delete(listener);
      if (current.listeners.size > 0) return;
      current.stop?.();
      current.generation++;
      if (this.#sources.get(serverId) === current) this.#sources.delete(serverId);
    };
  }

  close(): void {
    this.#stopResets();
    for (const source of this.#sources.values()) {
      source.stop?.();
      source.listeners.clear();
    }
    this.#sources.clear();
  }

  async #follow(serverId: string, source: Source): Promise<void> {
    const generation = ++source.generation;
    const stop = await this.logs.subscribe(serverId, (lines) => {
      for (const line of lines) {
        const event = parseLogLine(line.text);
        if (event === null) continue;
        for (const listener of source.listeners) {
          try {
            listener(event);
          } catch {
            // A failing listener must not stop the others.
          }
        }
      }
    });
    if (generation !== source.generation) {
      stop();
      return;
    }
    source.stop = stop;
  }
}
