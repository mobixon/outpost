import { z } from 'zod';
import { iconSchema } from '../shared.js';
import { DataError } from './data.js';
import { resolveIcons, texturesOf } from './icons.js';
import { readZip, unzip } from './zip.js';

// Downloads the official Minecraft client from Mojang, as map renderers such as BlueMap do, and
// keeps only what Outpost shows: item icons and the English and Russian names. Nothing of the game
// is shipped with Outpost; each instance gets its own copy after its owner accepts the EULA.

export const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
export const RESOURCES_URL = 'https://resources.download.minecraft.net';
const TIMEOUT_MS = 5 * 60_000;
const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;
/** Translations Outpost keeps: items and blocks, enchantments, mobs, statistics, advancements. */
const NAME_PREFIXES = ['item.', 'block.', 'enchantment.', 'entity.', 'stat.', 'advancements.'];

export class AssetError extends Error {
  override name = 'AssetError';

  constructor(
    /** e.g. `version_unknown`, `download_failed`, `checksum_mismatch`, `invalid_download`. */
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const namesSchema = z.record(z.string(), z.string());
export const assetSetSchema = z.object({
  version: z.string(),
  icons: z.record(z.string(), iconSchema),
  /** PNG data URLs by texture, e.g. `item/diamond_sword`. */
  textures: z.record(z.string(), z.string()),
  names: z.object({ en: namesSchema, ru: namesSchema }),
});
export type AssetSet = z.infer<typeof assetSetSchema>;

const manifestSchema = z.object({
  versions: z.array(z.object({ id: z.string(), url: z.url(), sha1: z.string() })),
});
const versionSchema = z.object({
  assetIndex: z.object({ url: z.url(), sha1: z.string() }),
  downloads: z.object({ client: z.object({ url: z.url(), sha1: z.string() }) }),
});
const assetIndexSchema = z.object({
  objects: z.record(z.string(), z.object({ hash: z.string().regex(/^[0-9a-f]{40}$/) })),
});

async function sha1(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', data));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function base64(data: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < data.length; at += 0x8000) {
    binary += String.fromCharCode(...data.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

const decoder = new TextDecoder();

function parse<S extends z.ZodType>(schema: S, data: Uint8Array, what: string): z.output<S> {
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(data));
  } catch {
    throw new AssetError('invalid_download', `${what} is not JSON`);
  }
  const result = schema.safeParse(value);
  if (!result.success) throw new AssetError('invalid_download', `${what} has an unknown format`);
  return result.data;
}

const keepNames = (names: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(names).filter(([key]) => NAME_PREFIXES.some((prefix) => key.startsWith(prefix))),
  );

/** Downloads the icons and names of a Minecraft version from Mojang. */
export async function downloadAssets(
  version: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<AssetSet> {
  const get = async (url: string, checksum?: string): Promise<Uint8Array<ArrayBuffer>> => {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (err) {
      throw new AssetError('download_failed', `${url}: ${String(err)}`);
    }
    if (!response.ok) throw new AssetError('download_failed', `${url}: HTTP ${response.status}`);
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.length > MAX_DOWNLOAD_BYTES)
      throw new AssetError('download_failed', `${url} is too large`);
    if (checksum !== undefined && (await sha1(data)) !== checksum) {
      throw new AssetError('checksum_mismatch', `${url} does not match its checksum`);
    }
    return data;
  };

  const manifest = parse(manifestSchema, await get(MANIFEST_URL), 'The version list');
  const entry = manifest.versions.find((candidate) => candidate.id === version);
  if (entry === undefined) {
    throw new AssetError('version_unknown', `Mojang does not list Minecraft ${version}`);
  }
  const meta = parse(versionSchema, await get(entry.url, entry.sha1), `Minecraft ${version}`);
  const jar = await get(meta.downloads.client.url, meta.downloads.client.sha1);

  try {
    const zip = readZip(jar);
    const cache = new Map<string, unknown>();
    const read = async (path: string): Promise<unknown> => {
      if (cache.has(path)) return cache.get(path);
      const zipEntry = zip.get(path);
      let value: unknown;
      if (zipEntry !== undefined) {
        try {
          value = JSON.parse(decoder.decode(await unzip(jar, zipEntry)));
        } catch (err) {
          if (err instanceof DataError) throw err;
          value = undefined;
        }
      }
      cache.set(path, value);
      return value;
    };

    const idsIn = (folder: string) =>
      [...zip.keys()].flatMap(
        (name) =>
          new RegExp(`^assets/minecraft/${folder}/([a-z0-9_.-]+)\\.json$`).exec(name)?.[1] ?? [],
      );
    const definitions = idsIn('items');
    const icons = await resolveIcons(
      read,
      definitions.length > 0 ? definitions : idsIn('models/item'),
      definitions.length > 0,
    );

    const textures: Record<string, string> = {};
    for (const texture of new Set(Object.values(icons).flatMap(texturesOf))) {
      const zipEntry = zip.get(`assets/minecraft/textures/${texture}.png`);
      if (zipEntry !== undefined) {
        textures[texture] = `data:image/png;base64,${base64(await unzip(jar, zipEntry))}`;
      }
    }
    // Icons with a texture the client lacks would show broken images.
    const complete = Object.fromEntries(
      Object.entries(icons).filter(([, icon]) =>
        texturesOf(icon).every((texture) => texture in textures),
      ),
    );

    const english = zip.get('assets/minecraft/lang/en_us.json');
    const en =
      english === undefined
        ? {}
        : keepNames(parse(namesSchema, await unzip(jar, english), 'The English names'));
    const index = parse(
      assetIndexSchema,
      await get(meta.assetIndex.url, meta.assetIndex.sha1),
      'The asset index',
    );
    const russian = index.objects['minecraft/lang/ru_ru.json']?.hash;
    const ru =
      russian === undefined
        ? {}
        : keepNames(
            parse(
              namesSchema,
              await get(`${RESOURCES_URL}/${russian.slice(0, 2)}/${russian}`, russian),
              'The Russian names',
            ),
          );
    return { version, icons: complete, textures, names: { en, ru } };
  } catch (err) {
    if (err instanceof DataError) throw new AssetError('invalid_download', err.message);
    throw err;
  }
}
