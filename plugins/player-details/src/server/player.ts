import type { Item, Place, PlayerDetail, PlayerStats, Stat, StoredItem } from '../shared.js';
import type { Names } from './names.js';
import { isCompound, type NbtCompound, type NbtValue } from './nbt.js';

// Reads what Outpost shows from the files of a player, for the formats since Minecraft 1.13:
// item stacks with `tag` (before 1.20.5) or `components`, armor in the inventory (before 1.21.5)
// or in `equipment`.

type Json = Record<string, unknown>;

const isJson = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const numberOf = (value: unknown): number | null =>
  typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : null;
const stringOf = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const listOf = (value: unknown): NbtValue[] => (Array.isArray(value) ? (value as NbtValue[]) : []);
const pathOf = (id: string) => id.slice(id.indexOf(':') + 1);

const TOOL_DURABILITY: Record<string, number> = {
  wooden: 59,
  stone: 131,
  copper: 190,
  iron: 250,
  golden: 32,
  diamond: 1561,
  netherite: 2031,
};
const ARMOR_FACTOR: Record<string, number> = {
  leather: 5,
  chainmail: 15,
  copper: 11,
  iron: 15,
  golden: 7,
  diamond: 33,
  netherite: 37,
};
const ARMOR_SLOT: Record<string, number> = { helmet: 11, chestplate: 16, leggings: 15, boots: 13 };
const DURABILITY: Record<string, number> = {
  bow: 384,
  brush: 64,
  carrot_on_a_stick: 25,
  crossbow: 465,
  elytra: 432,
  fishing_rod: 64,
  flint_and_steel: 64,
  mace: 500,
  shears: 238,
  shield: 336,
  trident: 250,
  turtle_helmet: 275,
  warped_fungus_on_a_stick: 100,
  wolf_armor: 64,
};

/** The durability of vanilla items that wear out; null for others. */
function durabilityOf(id: string): number | null {
  const path = pathOf(id);
  if (DURABILITY[path] !== undefined) return DURABILITY[path];
  const tool = /^([a-z]+)_(?:sword|pickaxe|axe|shovel|hoe)$/.exec(path);
  if (tool) return TOOL_DURABILITY[tool[1] ?? ''] ?? null;
  const armor = /^([a-z]+)_(helmet|chestplate|leggings|boots)$/.exec(path);
  if (armor) {
    const factor = ARMOR_FACTOR[armor[1] ?? ''];
    const slot = ARMOR_SLOT[armor[2] ?? ''];
    return factor === undefined || slot === undefined ? null : factor * slot;
  }
  return null;
}

/** The text of a chat component: JSON text (before 1.21.5), or NBT strings and compounds. */
export function plainText(value: unknown): string | null {
  const flatten = (component: unknown): string => {
    if (typeof component === 'string') return component;
    if (typeof component === 'number') return String(component);
    if (Array.isArray(component)) return component.map(flatten).join('');
    if (isJson(component)) {
      const own = component.text ?? component.translate ?? '';
      return flatten(own) + flatten(component.extra ?? []);
    }
    return '';
  };
  if (typeof value === 'string') {
    const text = value.trim();
    if (/^[[{"]/.test(text)) {
      try {
        return flatten(JSON.parse(text));
      } catch {
        return value;
      }
    }
    return value;
  }
  return value === undefined || value === null ? null : flatten(value);
}

function enchantmentsOf(
  components: NbtCompound | null,
  tag: NbtCompound | null,
  names: Names,
): Item['enchantments'] {
  const levels: [string, number][] = [];
  for (const key of ['minecraft:enchantments', 'minecraft:stored_enchantments']) {
    const value = components?.[key];
    if (!isCompound(value)) continue;
    // 1.20.5–1.21.4 wrap the levels: { levels: {...}, show_in_tooltip }.
    const map = isCompound(value.levels) ? value.levels : value;
    for (const [id, level] of Object.entries(map)) {
      const number = numberOf(level);
      if (number !== null) levels.push([id, number]);
    }
  }
  for (const key of ['Enchantments', 'StoredEnchantments']) {
    for (const entry of listOf(tag?.[key])) {
      if (!isCompound(entry)) continue;
      const id = stringOf(entry.id);
      const level = numberOf(entry.lvl);
      if (id !== null && level !== null) levels.push([id, level]);
    }
  }
  return levels.map(([id, level]) => ({ id, label: names.enchantment(id, level) }));
}

/** An item stack without what it holds; null for empty slots and unknown data. */
function readStoredItem(value: unknown, names: Names): StoredItem | null {
  if (!isCompound(value)) return null;
  const id = stringOf(value.id);
  if (id === null || id === 'minecraft:air') return null;
  const components = isCompound(value.components) ? value.components : null;
  const tag = isCompound(value.tag) ? value.tag : null;
  const display = isCompound(tag?.display) ? tag.display : null;

  const potionContents = components?.['minecraft:potion_contents'];
  const potion = isCompound(potionContents)
    ? stringOf(potionContents.potion)
    : (stringOf(potionContents) ?? stringOf(tag?.Potion));
  const maxDamage = numberOf(components?.['minecraft:max_damage']) ?? durabilityOf(id);
  const damage = numberOf(components?.['minecraft:damage']) ?? numberOf(tag?.Damage);
  return {
    slot: numberOf(value.Slot) ?? numberOf(value.slot) ?? 0,
    id,
    count: numberOf(value.count) ?? numberOf(value.Count) ?? 1,
    label: names.item(id, potion),
    customName: plainText(components?.['minecraft:custom_name'] ?? display?.Name),
    enchantments: enchantmentsOf(components, tag, names),
    damage: damage ?? (maxDamage === null ? null : 0),
    maxDamage,
    icon: stringOf(components?.['minecraft:item_model']) ?? id,
  };
}

/** The items a shulker box or a bundle holds: `components` since 1.20.5, `tag` before. */
function contentsOf(value: NbtCompound, names: Names): StoredItem[] | null {
  const components = isCompound(value.components) ? value.components : null;
  const tag = isCompound(value.tag) ? value.tag : null;
  const container = components?.['minecraft:container'];
  if (Array.isArray(container)) {
    return listOf(container).flatMap((entry) => {
      if (!isCompound(entry)) return [];
      const item = readStoredItem(entry.item, names);
      return item ? [{ ...item, slot: numberOf(entry.slot) ?? 0 }] : [];
    });
  }
  const bundle = components?.['minecraft:bundle_contents'];
  if (Array.isArray(bundle)) {
    return listOf(bundle).flatMap((entry, index) => {
      const item = readStoredItem(entry, names);
      return item ? [{ ...item, slot: index }] : [];
    });
  }
  const blockEntity = isCompound(tag?.BlockEntityTag) ? tag.BlockEntityTag : null;
  if (blockEntity !== null && Array.isArray(blockEntity.Items)) {
    return listOf(blockEntity.Items).flatMap((entry) => readStoredItem(entry, names) ?? []);
  }
  return null;
}

/** An item stack of a player file; null for empty slots and unknown data. */
export function readItem(value: unknown, names: Names): Item | null {
  const item = readStoredItem(value, names);
  return item === null || !isCompound(value)
    ? null
    : { ...item, contents: contentsOf(value, names) };
}

const LEGACY_DIMENSIONS: Record<number, string> = {
  [-1]: 'minecraft:the_nether',
  0: 'minecraft:overworld',
  1: 'minecraft:the_end',
};

function dimensionOf(value: unknown): string {
  const number = numberOf(value);
  if (number !== null) return LEGACY_DIMENSIONS[number] ?? String(number);
  return stringOf(value) ?? 'minecraft:overworld';
}

/** Three coordinates from a list or an int array. */
function coordinatesOf(value: unknown): [number, number, number] | null {
  const numbers = value instanceof Int32Array ? [...value] : listOf(value).map(numberOf);
  const [x, y, z] = numbers;
  return numbers.length === 3 &&
    typeof x === 'number' &&
    typeof y === 'number' &&
    typeof z === 'number'
    ? [x, y, z]
    : null;
}

/** A place from `{ pos: [x, y, z], dimension }`, as 1.19+ store respawn and death places. */
function placeOf(value: unknown): Place | null {
  if (!isCompound(value)) return null;
  const coordinates = coordinatesOf(value.pos);
  if (coordinates === null) return null;
  const [x, y, z] = coordinates;
  return { x, y, z, dimension: dimensionOf(value.dimension) };
}

const GAME_MODES = ['survival', 'creative', 'adventure', 'spectator'] as const;
const LEGACY_ARMOR_SLOTS: Record<number, 'feet' | 'legs' | 'chest' | 'head'> = {
  100: 'feet',
  101: 'legs',
  102: 'chest',
  103: 'head',
};

export type PlayerData = Pick<
  PlayerDetail,
  | 'gameMode'
  | 'health'
  | 'food'
  | 'xpLevel'
  | 'xpProgress'
  | 'selectedSlot'
  | 'inventory'
  | 'armor'
  | 'offhand'
  | 'enderChest'
  | 'location'
>;

/** The inventory, ender chest and state of a player (`playerdata/<uuid>.dat`). */
export function readPlayer(data: NbtCompound, names: Names, withLocation: boolean): PlayerData {
  const inventory: Item[] = [];
  const armor: PlayerData['armor'] = { head: null, chest: null, legs: null, feet: null };
  let offhand: Item | null = null;
  for (const entry of listOf(data.Inventory)) {
    const item = readItem(entry, names);
    if (item === null) continue;
    const armorSlot = LEGACY_ARMOR_SLOTS[item.slot];
    if (item.slot >= 0 && item.slot <= 35) inventory.push(item);
    else if (armorSlot !== undefined) armor[armorSlot] = { ...item, slot: 0 };
    else if (item.slot === -106) offhand = { ...item, slot: 0 };
  }
  const equipment = isCompound(data.equipment) ? data.equipment : null;
  if (equipment !== null) {
    for (const key of ['head', 'chest', 'legs', 'feet'] as const) {
      const item = readItem(equipment[key], names);
      if (item !== null) armor[key] = { ...item, slot: 0 };
    }
    const item = readItem(equipment.offhand, names);
    if (item !== null) offhand = { ...item, slot: 0 };
  }

  let location: PlayerData['location'] = null;
  if (withLocation) {
    const pos = coordinatesOf(data.Pos);
    const position = pos && {
      x: pos[0],
      y: pos[1],
      z: pos[2],
      dimension: dimensionOf(data.Dimension),
    };
    // Before 1.21.5 the respawn point was SpawnX, SpawnY, SpawnZ and SpawnDimension.
    const spawn = coordinatesOf([data.SpawnX, data.SpawnY, data.SpawnZ]);
    const respawn =
      placeOf(data.respawn) ??
      (spawn && {
        x: spawn[0],
        y: spawn[1],
        z: spawn[2],
        dimension: dimensionOf(data.SpawnDimension),
      });
    location = { position, respawn, lastDeath: placeOf(data.LastDeathLocation) };
  }

  const gameMode = numberOf(data.playerGameType);
  return {
    gameMode: gameMode === null ? null : (GAME_MODES[gameMode] ?? null),
    health: numberOf(data.Health),
    food: numberOf(data.foodLevel),
    xpLevel: numberOf(data.XpLevel),
    xpProgress: numberOf(data.XpP),
    selectedSlot: numberOf(data.SelectedItemSlot),
    inventory: inventory.sort((a, b) => a.slot - b.slot),
    armor,
    offhand,
    enderChest: listOf(data.EnderItems)
      .flatMap((entry) => readItem(entry, names) ?? [])
      .sort((a, b) => a.slot - b.slot),
    location,
  };
}

/** The statistics Outpost shows first, as `minecraft:custom` keys. */
export const CUSTOM_STATS = [
  'play_time',
  'deaths',
  'mob_kills',
  'player_kills',
  'damage_dealt',
  'damage_taken',
  'jump',
  'walk_one_cm',
  'sprint_one_cm',
  'swim_one_cm',
  'fly_one_cm',
  'aviate_one_cm',
  'boat_one_cm',
  'fish_caught',
  'animals_bred',
  'traded_with_villager',
  'sleep_in_bed',
];
const TOP_SIZE = 10;

/** The statistics of a player (`stats/<uuid>.json`, since 1.13); null for other formats. */
export function readStats(json: unknown, names: Names): PlayerStats | null {
  if (!isJson(json) || !isJson(json.stats)) return null;
  const stats = json.stats;
  const group = (kind: string): [string, number][] => {
    const values = stats[`minecraft:${kind}`];
    if (!isJson(values)) return [];
    return Object.entries(values).flatMap(([key, value]) =>
      typeof value === 'number' ? [[key, value] as [string, number]] : [],
    );
  };
  const top = (kind: string, label: (id: string) => string): Stat[] =>
    group(kind)
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_SIZE)
      .map(([key, value]) => ({ key, label: label(key), value }));

  const custom = new Map(group('custom'));
  // Before 1.17 the play time was `play_one_minute`, also counted in ticks.
  const legacyPlayTime = custom.get('minecraft:play_one_minute');
  if (!custom.has('minecraft:play_time') && legacyPlayTime !== undefined) {
    custom.set('minecraft:play_time', legacyPlayTime);
  }
  const item = (id: string) => names.item(id);
  const entity = (id: string) => names.entity(id);
  return {
    custom: CUSTOM_STATS.flatMap((key) => {
      const value = custom.get(`minecraft:${key}`);
      return value === undefined ? [] : [{ key, label: names.stat(`minecraft:${key}`), value }];
    }),
    mined: top('mined', item),
    used: top('used', item),
    crafted: top('crafted', item),
    killed: top('killed', entity),
    killedBy: top('killed_by', entity),
  };
}

// "2026-09-06 13:59:20 +0000"
const ADVANCEMENT_DATE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/;

function dateOf(text: unknown): string | null {
  const match = typeof text === 'string' ? ADVANCEMENT_DATE.exec(text) : null;
  if (!match) return null;
  const date = new Date(`${match[1]}T${match[2]}${match[3]}:${match[4]}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The advancements a player has made (`advancements/<uuid>.json`), the last one first. */
export function readAdvancements(json: unknown, names: Names): PlayerDetail['advancements'] {
  if (!isJson(json)) return null;
  return Object.entries(json)
    .flatMap(([id, value]) => {
      if (!isJson(value) || value.done !== true || id.includes(':recipes/')) return [];
      const dates = isJson(value.criteria)
        ? Object.values(value.criteria).flatMap((date) => dateOf(date) ?? [])
        : [];
      const doneAt = dates.sort().at(-1) ?? null;
      return [{ id, title: names.advancement(id), doneAt }];
    })
    .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
}
