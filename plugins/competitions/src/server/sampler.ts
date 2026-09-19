import type { PluginContext } from '@outpost/plugin-api';
import { blockMatcher, type Metric, metricPatterns } from '../shared.js';

/** How many files of players are read at once. */
const PARALLEL_READS = 6;

interface Cached {
  modifiedAt: number;
  value: number;
}

/** What the counter of a metric is for every player: the players and their totals. */
export type Counters = Map<string, number>;

/**
 * Reads the counters of a metric from the statistics of the players. The files of players who have
 * not played since the last read are not read again: the server writes a file when its player
 * leaves and at every autosave, so an unchanged file means an unchanged counter.
 */
export class Sampler {
  readonly #cache = new Map<string, Map<string, Cached>>();

  constructor(private readonly ctx: PluginContext) {}

  /**
   * The total of the metric for every player who has statistics. With `fresh` every file is read
   * again, which the start and the end of a competition need to be exact.
   */
  async measure(
    serverId: string,
    cacheKey: string,
    metric: Metric,
    options: { fresh?: boolean } = {},
  ): Promise<Counters> {
    const matches = blockMatcher(metricPatterns(metric));
    const files = await this.ctx.stats.list(serverId);
    const cached = options.fresh === true ? new Map<string, Cached>() : this.#cacheOf(cacheKey);
    const next = new Map<string, Cached>();
    const totals: Counters = new Map();

    const queue = [...files];
    const worker = async () => {
      for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
        const modifiedAt = file.modifiedAt.getTime();
        const known = cached.get(file.uuid);
        let value: number;
        if (known !== undefined && known.modifiedAt === modifiedAt) {
          value = known.value;
        } else {
          const stats = await this.ctx.stats.read(serverId, file.uuid);
          value = 0;
          for (const [id, count] of Object.entries(stats?.mined ?? {})) {
            if (matches(id)) value += count;
          }
        }
        next.set(file.uuid, { modifiedAt, value });
        totals.set(file.uuid, value);
      }
    };
    await Promise.all(Array.from({ length: PARALLEL_READS }, worker));
    this.#cache.set(cacheKey, next);
    return totals;
  }

  #cacheOf(key: string): Map<string, Cached> {
    return this.#cache.get(key) ?? new Map();
  }

  /** Forgets what was read for a competition, e.g. when it is over or its metric changed. */
  forget(cacheKey: string): void {
    this.#cache.delete(cacheKey);
  }
}
