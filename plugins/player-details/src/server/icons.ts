import type { Icon, IconLayer } from '../shared.js';

// Turns the models of the Minecraft client into icons Outpost can draw: the texture layers of flat
// items, or the top and two sides of blocks. Special renderers (chests, banners, heads) have no
// textures of their own; their items get the particle texture where it fits, or no icon.

type Json = Record<string, unknown>;
/** Reads a JSON file of the client, e.g. `assets/minecraft/models/item/stick.json`. */
export type AssetReader = (path: string) => Promise<unknown>;

interface ModelRef {
  model: string;
  /** Tint per texture layer. */
  tints: (number | null)[];
}

const isJson = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const typeOf = (value: Json) => String(value.type ?? '').replace(/^minecraft:/, '');

/** Items tinted with the grass colour, as the game shows them in the inventory. */
const GRASS = 0x79c05a;

function tintOf(value: unknown): number | null {
  if (!isJson(value)) return null;
  const color =
    typeof value.value === 'number'
      ? value.value
      : typeof value.default === 'number'
        ? value.default
        : typeOf(value) === 'grass'
          ? GRASS
          : null;
  return color === null ? null : (color >>> 0) & 0xffffff;
}

/** The model an item definition (`items/<id>.json`, 1.21.4+) shows by default. */
export function modelRefOf(definition: unknown, depth = 0): ModelRef | null {
  if (!isJson(definition) || depth > 16) return null;
  const nested = (value: unknown) => modelRefOf(value, depth + 1);
  switch (typeOf(definition)) {
    case 'model':
      return typeof definition.model === 'string'
        ? {
            model: definition.model,
            tints: Array.isArray(definition.tints) ? definition.tints.map(tintOf) : [],
          }
        : null;
    case 'special':
      return typeof definition.base === 'string' ? { model: definition.base, tints: [] } : null;
    case 'select':
    case 'range_dispatch': {
      const options = Array.isArray(definition.cases)
        ? definition.cases
        : Array.isArray(definition.entries)
          ? definition.entries
          : [];
      const first: unknown = options[0];
      return nested(definition.fallback) ?? (isJson(first) ? nested(first.model) : null);
    }
    case 'condition':
      return nested(definition.on_false) ?? nested(definition.on_true);
    case 'composite': {
      for (const model of Array.isArray(definition.models) ? definition.models : []) {
        const ref = nested(model);
        if (ref) return ref;
      }
      return null;
    }
    default:
      return null;
  }
}

/** `minecraft:block/stone` → `block/stone`; null for other namespaces. */
export function assetPath(ref: string): string | null {
  const colon = ref.indexOf(':');
  if (colon !== -1 && ref.slice(0, colon) !== 'minecraft') return null;
  return ref.slice(colon + 1);
}

const TOP = ['up', 'top', 'end', 'all', 'particle'];
const LEFT = ['north', 'front', 'side', 'all', 'particle'];
const RIGHT = ['east', 'side', 'all', 'particle'];

/** The icon of a model, following its parents. */
export async function iconOf(ref: ModelRef, read: AssetReader): Promise<Icon | null> {
  const textures: Record<string, string> = {};
  let block = false;
  let path = assetPath(ref.model);
  for (let depth = 0; path !== null && depth < 32 && !path.startsWith('builtin/'); depth++) {
    if (path.startsWith('block/')) block = true;
    const model = await read(`assets/minecraft/models/${path}.json`);
    if (!isJson(model)) break;
    if (isJson(model.textures)) {
      for (const [name, value] of Object.entries(model.textures)) {
        if (typeof value === 'string' && !(name in textures)) textures[name] = value;
      }
    }
    path = typeof model.parent === 'string' ? assetPath(model.parent) : null;
  }

  const texture = (name: string): string | null => {
    let value = textures[name];
    for (let hops = 0; value?.startsWith('#') && hops < 16; hops++)
      value = textures[value.slice(1)];
    return value === undefined || value.startsWith('#') ? null : assetPath(value);
  };
  const first = (names: readonly string[]) => {
    for (const name of names) {
      const found = texture(name);
      if (found !== null) return found;
    }
    return null;
  };

  const layers: IconLayer[] = [];
  for (let found = texture('layer0'); found !== null; found = texture(`layer${layers.length}`)) {
    layers.push({ texture: found, tint: ref.tints[layers.length] ?? null });
  }
  if (layers.length > 0) return { kind: 'flat', layers };

  if (block) {
    const [top, left, right] = [first(TOP), first(LEFT), first(RIGHT)];
    if (top !== null && left !== null && right !== null) {
      // Tinted blocks: leaves everywhere, grass only on the top.
      const tint = ref.tints[0] ?? null;
      const side = (name: string) => ({ texture: name, tint: name === top ? tint : null });
      return { kind: 'cube', top: { texture: top, tint }, left: side(left), right: side(right) };
    }
  }
  const particle = texture('particle');
  // Chests, banners and shields have planks as their particle and heads soul sand: misleading.
  return particle !== null && !particle.endsWith('planks') && particle !== 'block/soul_sand'
    ? { kind: 'flat', layers: [{ texture: particle, tint: null }] }
    : null;
}

/** The textures an icon uses. */
export function texturesOf(icon: Icon): string[] {
  return icon.kind === 'flat'
    ? icon.layers.map((layer) => layer.texture)
    : [icon.top.texture, icon.left.texture, icon.right.texture];
}

/**
 * Icons of the items, by item id (`minecraft:stone`). `definitions` tells whether the client has
 * item definitions (`items/<id>.json`, 1.21.4+); older clients have item models only.
 */
export async function resolveIcons(
  read: AssetReader,
  itemIds: readonly string[],
  definitions: boolean,
): Promise<Record<string, Icon>> {
  const icons: Record<string, Icon> = {};
  for (const id of itemIds) {
    const ref = definitions
      ? modelRefOf(
          ((await read(`assets/minecraft/items/${id}.json`)) as { model?: unknown } | undefined)
            ?.model,
        )
      : { model: `minecraft:item/${id}`, tints: [] };
    const icon = ref && (await iconOf(ref, read));
    if (icon) icons[`minecraft:${id}`] = icon;
  }
  return icons;
}
