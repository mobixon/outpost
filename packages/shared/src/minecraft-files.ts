// Files of a Minecraft Java server that tell about players: statistics, operators, name cache.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Lowercase UUID with dashes; null when the text is not a UUID. */
export function normalizeUuid(text: string): string | null {
  const uuid = text.trim().toLowerCase();
  return UUID_PATTERN.test(uuid) ? uuid : null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The counters of a player: by category (`mined`, `killed`, `crafted`, `custom`, …, without the
 * `minecraft:` prefix), then by id (`minecraft:oak_log`).
 */
export type PlayerStats = Record<string, Record<string, number>>;

/** Parses `stats/<uuid>.json` (since 1.13); null for other formats. */
export function parseStats(json: unknown): PlayerStats | null {
  if (!isRecord(json) || !isRecord(json.stats)) return null;
  const stats: PlayerStats = {};
  for (const [category, values] of Object.entries(json.stats)) {
    if (!isRecord(values)) continue;
    const counters: Record<string, number> = {};
    for (const [id, value] of Object.entries(values)) {
      if (typeof value === 'number' && Number.isFinite(value)) counters[id] = value;
    }
    stats[category.replace(/^minecraft:/, '')] = counters;
  }
  return stats;
}

/** A player known by name and UUID, as `ops.json` and `usercache.json` list them. */
export interface NamedPlayer {
  uuid: string;
  name: string;
}

function namedPlayers(json: unknown): NamedPlayer[] | null {
  if (!Array.isArray(json)) return null;
  const players: NamedPlayer[] = [];
  for (const entry of json as unknown[]) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.uuid !== 'string') {
      continue;
    }
    const uuid = normalizeUuid(entry.uuid);
    if (uuid !== null) players.push({ uuid, name: entry.name });
  }
  return players;
}

/** The operators of `ops.json`; null for other formats. */
export const parseOps = namedPlayers;

/** The players `usercache.json` remembers, most recently seen first; null for other formats. */
export const parseUserCache = namedPlayers;
