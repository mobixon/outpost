import type { Kysely, PluginLogger } from '@outpost/plugin-api';
import type { Assets } from '../shared.js';
import { AssetError, assetSetSchema, type AssetSet } from './mojang.js';
import type { PlayerDetailsTables } from './tables.js';

/**
 * The downloaded icons and names per Minecraft version: in the database, cached in memory once
 * read, downloaded in the background one version at a time.
 */
export class AssetStore {
  readonly #cache = new Map<string, AssetSet>();
  readonly #jobs = new Map<string, Promise<void>>();
  readonly #failures = new Map<string, string>();

  constructor(
    private readonly db: Kysely<PlayerDetailsTables>,
    private readonly download: (version: string) => Promise<AssetSet>,
    private readonly logger: PluginLogger,
  ) {}

  async get(version: string | null): Promise<AssetSet | null> {
    if (version === null) return null;
    const cached = this.#cache.get(version);
    if (cached !== undefined) return cached;
    const row = await this.db
      .selectFrom('pd_assets')
      .select('data')
      .where('version', '=', version)
      .executeTakeFirst();
    if (row === undefined) return null;
    const set = assetSetSchema.parse(JSON.parse(row.data));
    this.#cache.set(version, set);
    return set;
  }

  async state(version: string | null): Promise<Assets> {
    if (version === null) return { version, state: 'missing', error: null };
    if (this.#jobs.has(version)) return { version, state: 'downloading', error: null };
    if ((await this.get(version)) !== null) return { version, state: 'ready', error: null };
    const error = this.#failures.get(version) ?? null;
    return { version, state: error === null ? 'missing' : 'failed', error };
  }

  /** Starts downloading a version unless it is being downloaded. */
  start(version: string): void {
    if (this.#jobs.has(version)) return;
    this.#failures.delete(version);
    const job = this.download(version)
      .then(async (set) => {
        const row = { data: JSON.stringify(set), downloaded_at: Date.now() };
        await this.db
          .insertInto('pd_assets')
          .values({ version, ...row })
          .onConflict((conflict) => conflict.column('version').doUpdateSet(row))
          .execute();
        this.#cache.set(version, set);
      })
      .catch((err: unknown) => {
        this.#failures.set(version, err instanceof AssetError ? err.code : 'download_failed');
        this.logger.warn('downloading the Minecraft icons failed', {
          version,
          error: String(err),
        });
      })
      .finally(() => this.#jobs.delete(version));
    this.#jobs.set(version, job);
  }

  /** Resolves when no download is running. */
  async idle(): Promise<void> {
    await Promise.all(this.#jobs.values());
  }
}
