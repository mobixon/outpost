/**
 * Counts failures per key in a fixed time window, e.g. failed logins per username and per client
 * IP. Kept in memory: Outpost runs as a single process, and a restart only resets the counters.
 */
export class FailureLimiter {
  readonly #entries = new Map<string, { failures: number; resetAt: number }>();

  constructor(
    readonly maxFailures: number,
    readonly windowMs: number,
  ) {}

  /** Milliseconds until the key may try again; 0 when it is not blocked. */
  blockedFor(key: string): number {
    const entry = this.#entries.get(key);
    const now = Date.now();
    if (entry === undefined || entry.resetAt <= now || entry.failures < this.maxFailures) return 0;
    return entry.resetAt - now;
  }

  recordFailure(key: string): void {
    const now = Date.now();
    const entry = this.#entries.get(key);
    if (entry === undefined || entry.resetAt <= now) {
      this.#entries.set(key, { failures: 1, resetAt: now + this.windowMs });
      this.#prune(now);
    } else {
      entry.failures += 1;
    }
  }

  reset(key: string): void {
    this.#entries.delete(key);
  }

  #prune(now: number): void {
    if (this.#entries.size < 10_000) return;
    for (const [key, entry] of this.#entries) {
      if (entry.resetAt <= now) this.#entries.delete(key);
    }
  }
}
