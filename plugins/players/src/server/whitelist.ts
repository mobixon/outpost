import { HttpError, type PluginContext } from '@outpost/plugin-api';
import { offlineUuid, uuidMode } from '@outpost/shared';
import { z } from 'zod';
import type { ServerMode } from '../shared.js';

export const WHITELIST_FILE = 'whitelist.json';

// Entries keep fields Outpost does not know.
const fileSchema = z.array(z.looseObject({ uuid: z.string(), name: z.string() }));
export type WhitelistFileEntry = z.infer<typeof fileSchema>[number];

const decoder = new TextDecoder();

/** Reads whitelist.json; a missing or empty file is an empty list (the server writes it on start). */
export async function readWhitelist(
  files: PluginContext['files'],
  serverId: string,
): Promise<WhitelistFileEntry[]> {
  let text: string;
  try {
    text = decoder.decode(await files.read(serverId, WHITELIST_FILE));
  } catch (err) {
    if (err instanceof HttpError && err.code === 'file_not_found') return [];
    throw err;
  }
  if (text.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const result = fileSchema.safeParse(parsed);
  if (!result.success) {
    throw new HttpError(409, 'whitelist_invalid', `${WHITELIST_FILE} is not a list of players`);
  }
  return result.data;
}

/** Writes whitelist.json as Minecraft does, with one entry per UUID. */
export async function writeWhitelist(
  files: PluginContext['files'],
  serverId: string,
  entries: readonly WhitelistFileEntry[],
): Promise<void> {
  const seen = new Set<string>();
  const unique = entries.filter((entry) => {
    const key = entry.uuid.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  await files.write(serverId, WHITELIST_FILE, JSON.stringify(unique, null, 2));
}

/** The name as the server knows the player (offline UUIDs depend on its case), else as given. */
export function properName(name: string, known: readonly string[]): string {
  if (known.includes(name)) return name;
  return known.find((other) => other.toLowerCase() === name.toLowerCase()) ?? name;
}

/**
 * Whether the player of an entry cannot join because of its UUID (the UUID doctor): on offline-mode
 * servers a Mojang UUID or a name-based one of another spelling of the name, on online-mode servers
 * a name-based UUID. Other UUIDs, such as those of Bedrock players (Floodgate), are left alone.
 */
export function hasWrongUuid(
  entry: { name: string; uuid: string },
  mode: ServerMode | null,
  known: readonly string[],
): boolean {
  const kind = uuidMode(entry.uuid);
  if (mode === 'online') return kind === 'offline';
  if (mode === 'offline') {
    return (
      kind === 'online' ||
      (kind === 'offline' &&
        entry.uuid.toLowerCase() !== offlineUuid(properName(entry.name, known)))
    );
  }
  return false;
}

/** Runs tasks one after another per server, so that edits of a file do not undo each other. */
export class PerServerQueue {
  readonly #tails = new Map<string, Promise<unknown>>();

  run<T>(serverId: string, task: () => Promise<T>): Promise<T> {
    const result = (this.#tails.get(serverId) ?? Promise.resolve()).then(task);
    this.#tails.set(
      serverId,
      result.catch(() => undefined),
    );
    return result;
  }
}
