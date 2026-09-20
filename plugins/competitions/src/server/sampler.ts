import type { PlayerStats, PluginContext } from '@outpost/plugin-api';
import { selectorOf, type Metric } from '../metrics.js';

/** How many files of players are read at once. */
const PARALLEL_READS = 6;

/** How the counter of a metric is read from the statistics of a player. */
function counterOf(metric: Metric): (stats: PlayerStats) => number {
  const { category, matches } = selectorOf(metric);
  return (stats) => {
    let total = 0;
    for (const [id, count] of Object.entries(stats[category] ?? {})) {
      if (matches(id)) total += count;
    }
    return total;
  };
}

interface Cached {
  modifiedAt: number;
  values: number[];
}

/** What the counters of the metrics are for every player: the players and their totals. */
export type Counters = Map<string, number>;

/**
 * Reads the counters of metrics from the statistics of the players. The files of players who have
 * not played since the last read are not read again: the server writes a file when its player
 * leaves and at every autosave, so an unchanged file means unchanged counters.
 */
export class Sampler {
  readonly #cache = new Map<string, Map<string, Cached>>();

  constructor(private readonly ctx: PluginContext) {}

  /**
   * The totals of several metrics for every player who has statistics, read from each file once.
   * With `fresh` every file is read again, which the start and the end of a competition need to be
   * exact.
   */
  async measureMany(
    serverId: string,
    cacheKey: string,
    metrics: readonly Metric[],
    options: { fresh?: boolean } = {},
  ): Promise<Map<string, number[]>> {
    const counters = metrics.map(counterOf);
    const files = await this.ctx.stats.list(serverId);
    const cached = options.fresh === true ? new Map<string, Cached>() : this.#cacheOf(cacheKey);
    const next = new Map<string, Cached>();
    const totals = new Map<string, number[]>();

    const queue = [...files];
    const worker = async () => {
      for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
        const modifiedAt = file.modifiedAt.getTime();
        const known = cached.get(file.uuid);
        let values: number[];
        if (known !== undefined && known.modifiedAt === modifiedAt) {
          values = known.values;
        } else {
          const stats = await this.ctx.stats.read(serverId, file.uuid);
          values = counters.map((counter) => (stats === null ? 0 : counter(stats)));
        }
        next.set(file.uuid, { modifiedAt, values });
        totals.set(file.uuid, values);
      }
    };
    await Promise.all(Array.from({ length: PARALLEL_READS }, worker));
    this.#cache.set(cacheKey, next);
    return totals;
  }

  /** The total of one metric for every player who has statistics. */
  async measure(
    serverId: string,
    cacheKey: string,
    metric: Metric,
    options: { fresh?: boolean } = {},
  ): Promise<Counters> {
    const totals = await this.measureMany(serverId, cacheKey, [metric], options);
    return new Map([...totals].map(([uuid, values]) => [uuid, values[0] ?? 0]));
  }

  #cacheOf(key: string): Map<string, Cached> {
    return this.#cache.get(key) ?? new Map();
  }

  /** Forgets what was read for a competition, e.g. when it is over or its metric changed. */
  forget(cacheKey: string): void {
    this.#cache.delete(cacheKey);
  }
}
