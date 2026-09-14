/** Translations of the game, e.g. `item.minecraft.diamond_sword` → `Diamond Sword`. */
export type NameTable = Readonly<Record<string, string>>;

// Enchantments with one level only; the game shows them without a level.
const SINGLE_LEVEL = new Set([
  'aqua_affinity',
  'binding_curse',
  'channeling',
  'flame',
  'infinity',
  'mending',
  'multishot',
  'silk_touch',
  'vanishing_curse',
]);

const POTION_ITEMS = new Set(['potion', 'splash_potion', 'lingering_potion', 'tipped_arrow']);

const namespaceOf = (id: string) => (id.includes(':') ? id.slice(0, id.indexOf(':')) : 'minecraft');
const pathOf = (id: string) => id.slice(id.indexOf(':') + 1);

/** `minecraft:diamond_sword` → `Diamond Sword`, for things without a translation. */
export function prettify(id: string): string {
  const name = pathOf(id).split('/').pop() ?? id;
  return name
    .split('_')
    .filter((word) => word !== '')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Names of items, entities, statistics and advancements, from the downloaded translations. */
export class Names {
  constructor(
    private readonly table: NameTable = {},
    /** Asked when `table` lacks a name, e.g. English for another language. */
    private readonly fallback: NameTable = {},
  ) {}

  #get(key: string): string | undefined {
    return this.table[key] ?? this.fallback[key];
  }

  #key(kind: string, id: string): string {
    return `${kind}.${namespaceOf(id)}.${pathOf(id).replaceAll('/', '.')}`;
  }

  item(id: string, potion: string | null = null): string {
    if (potion !== null && POTION_ITEMS.has(pathOf(id))) {
      const effect = pathOf(potion).replace(/^(strong|long)_/, '');
      const name = this.#get(`${this.#key('item', id)}.effect.${effect}`);
      if (name !== undefined) return name;
    }
    return this.#get(this.#key('item', id)) ?? this.#get(this.#key('block', id)) ?? prettify(id);
  }

  entity(id: string): string {
    return this.#get(this.#key('entity', id)) ?? prettify(id);
  }

  stat(id: string): string {
    return this.#get(this.#key('stat', id)) ?? prettify(id);
  }

  enchantment(id: string, level: number): string {
    const name = this.#get(this.#key('enchantment', id)) ?? prettify(id);
    if (level === 1 && SINGLE_LEVEL.has(pathOf(id))) return name;
    return `${name} ${this.#get(`enchantment.level.${level}`) ?? level}`;
  }

  advancement(id: string): string {
    return this.#get(`advancements.${pathOf(id).replaceAll('/', '.')}.title`) ?? prettify(id);
  }
}
