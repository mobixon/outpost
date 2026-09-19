import { HttpError, type PluginContext } from '@outpost/plugin-api';
import { parseOps, parseUserCache, type NamedPlayer } from '@outpost/shared';
import '@outpost/plugin-players/service';

export const USER_CACHE_FILE = 'usercache.json';
export const OPS_FILE = 'ops.json';

const decoder = new TextDecoder();
/** How long the lists read from the files are remembered. */
const TTL_MS = 5 * 60_000;

/** The players of a server by name, and its operators, from the files and the Players module. */
export class PlayerDirectory {
  readonly #files = new Map<string, { at: number; players: NamedPlayer[] }>();

  constructor(private readonly ctx: PluginContext) {}

  async #read(
    serverId: string,
    file: string,
    parse: (json: unknown) => NamedPlayer[] | null,
  ): Promise<NamedPlayer[]> {
    const key = `${serverId}\n${file}`;
    const known = this.#files.get(key);
    if (known !== undefined && Date.now() - known.at < TTL_MS) return known.players;
    let players: NamedPlayer[] = [];
    try {
      const bytes = await this.ctx.files.read(serverId, file);
      players = parse(JSON.parse(decoder.decode(bytes))) ?? [];
    } catch (err) {
      // A missing file is an empty list; so is one that is being written.
      const missing =
        err instanceof HttpError && (err.statusCode === 404 || err.statusCode === 409);
      if (!missing && !(err instanceof SyntaxError)) throw err;
    }
    this.#files.set(key, { at: Date.now(), players });
    return players;
  }

  /** The UUIDs of the operators (`ops.json`). */
  async operators(serverId: string): Promise<Set<string>> {
    return new Set((await this.#read(serverId, OPS_FILE, parseOps)).map(({ uuid }) => uuid));
  }

  /** Names by UUID: the Players module first (the name a player had last), then the name cache. */
  async names(serverId: string): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    for (const { uuid, name } of await this.#read(serverId, USER_CACHE_FILE, parseUserCache)) {
      names.set(uuid, name);
    }
    for (const { uuid, name } of (await this.ctx.services
      .get('outpost.players')
      ?.known(serverId)) ?? []) {
      names.set(uuid, name);
    }
    for (const { uuid, name } of await this.#read(serverId, OPS_FILE, parseOps)) {
      if (!names.has(uuid)) names.set(uuid, name);
    }
    return names;
  }

  /** Forgets what was read, e.g. to see a player who has just joined. */
  forget(): void {
    this.#files.clear();
  }
}
