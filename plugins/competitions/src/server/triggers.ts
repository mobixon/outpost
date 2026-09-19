import { HttpError, type GameEvent, type Kysely, type PluginContext } from '@outpost/plugin-api';
import { CompetitionEngine, configOf, toEvent, type EventRow } from './engine.js';
import { renderJoin, renderTop } from '../render.js';
import type { CompetitionsTables } from './tables.js';

export interface TriggerOptions {
  /** A player can ask for the standings this often. */
  askCooldownMs: number;
  /** The notice on joining comes this long after the join, when the player can read it. */
  joinDelayMs: number;
}

export const DEFAULT_TRIGGER_OPTIONS: TriggerOptions = {
  askCooldownMs: 10_000,
  joinDelayMs: 4_000,
};

/** A player who joins again within this long is not shown the notice again. */
const JOIN_COOLDOWN_MS = 30 * 60_000;
/** At most this many competitions answer one chat message. */
const MAX_ANSWERS = 3;
/** The lists of who was told when are cleaned up when they grow past this. */
const REMEMBERED = 2000;

/** Forgets the entries older than `ttl` once a list is long. */
function tidy(times: Map<string, number>, now: number, ttl: number): void {
  if (times.size <= REMEMBERED) return;
  for (const [key, at] of times) if (now - at >= ttl) times.delete(key);
}

/**
 * What players do in the game: they ask for the standings in the chat, and they are told about the
 * running competitions when they join. The log of a server is followed while a competition runs
 * on it.
 */
export class Triggers {
  readonly #subscriptions = new Map<string, Promise<() => void>>();
  readonly #asked = new Map<string, number>();
  readonly #welcomed = new Map<string, number>();
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private readonly ctx: PluginContext,
    private readonly db: Kysely<CompetitionsTables>,
    private readonly engine: CompetitionEngine,
    private readonly options: TriggerOptions = DEFAULT_TRIGGER_OPTIONS,
  ) {}

  /** Follows the servers that have a running competition, and no others. */
  sync(active: ReadonlySet<string>): void {
    for (const serverId of active) {
      if (this.#subscriptions.has(serverId)) continue;
      const subscription = this.#subscribe(serverId);
      this.#subscriptions.set(serverId, subscription);
      subscription.catch((err: unknown) => {
        // The server cannot tell what its players do (yet): try again at the next look.
        this.#subscriptions.delete(serverId);
        if (!(err instanceof HttpError)) {
          this.ctx.logger.warn('following the players failed', { serverId, error: String(err) });
        }
      });
    }
    for (const [serverId, subscription] of this.#subscriptions) {
      if (active.has(serverId)) continue;
      this.#subscriptions.delete(serverId);
      subscription.then(
        (stop) => stop(),
        () => undefined,
      );
    }
  }

  stop(): void {
    for (const subscription of this.#subscriptions.values()) {
      subscription.then(
        (stop) => stop(),
        () => undefined,
      );
    }
    this.#subscriptions.clear();
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
  }

  #subscribe(serverId: string): Promise<() => void> {
    return this.ctx.gameEvents.subscribe(serverId, (event) => {
      void this.#handle(serverId, event).catch((err: unknown) => {
        this.ctx.logger.debug('answering a player failed', { serverId, error: String(err) });
      });
    });
  }

  async #handle(serverId: string, event: GameEvent): Promise<void> {
    if (event.type === 'joined') {
      // Rewards wait for the player: hand them out now, not at the next look at who is online.
      this.ctx.playerTasks.playerJoined(serverId, event.player);
      const timer = setTimeout(() => {
        this.#timers.delete(timer);
        void this.#welcome(serverId, event.player).catch(() => undefined);
      }, this.options.joinDelayMs);
      this.#timers.add(timer);
    } else if (event.type === 'chat') {
      await this.#answer(serverId, event.player, event.message);
    }
  }

  async #running(serverId: string): Promise<EventRow[]> {
    return await this.db
      .selectFrom('comp_events')
      .selectAll()
      .where('server_id', '=', serverId)
      .where('state', '=', 'active')
      .orderBy('ends_at')
      .execute();
  }

  async #answer(serverId: string, player: string, message: string): Promise<void> {
    const text = message.trim().toLowerCase();
    if (!text.startsWith('!') && !/^[#.$%-]/.test(text)) return;
    const events = (await this.#running(serverId))
      .filter((row) => configOf(row).messages.command.toLowerCase() === text)
      .slice(0, MAX_ANSWERS);
    if (events.length === 0) return;
    const key = `${serverId}\n${player.toLowerCase()}`;
    const now = Date.now();
    if (now - (this.#asked.get(key) ?? 0) < this.options.askCooldownMs) return;
    this.#asked.set(key, now);
    tidy(this.#asked, now, this.options.askCooldownMs);
    for (const row of events) {
      const lines = renderTop(toEvent(row), await this.engine.standings(row), now, {
        name: player,
      });
      if (lines.length > 0) await this.ctx.chat.tell(serverId, player, lines);
    }
  }

  async #welcome(serverId: string, player: string): Promise<void> {
    const now = Date.now();
    for (const row of await this.#running(serverId)) {
      if (!configOf(row).messages.joinNotice) continue;
      const key = `${row.id}\n${player.toLowerCase()}`;
      if (now - (this.#welcomed.get(key) ?? 0) < JOIN_COOLDOWN_MS) continue;
      this.#welcomed.set(key, now);
      tidy(this.#welcomed, now, JOIN_COOLDOWN_MS);
      const lines = renderJoin(toEvent(row), await this.engine.standings(row), now, {
        name: player,
      });
      if (lines.length > 0) await this.ctx.chat.tell(serverId, player, lines);
    }
  }
}
