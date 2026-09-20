import { z } from 'zod';

// What can be counted: blocks mined, and any other statistic of the game.

export const MAX_BLOCKS = 50;
export const MAX_TARGETS = 10;
export const MAX_TARGET_AMOUNT = 1_000_000;
export const MAX_TARGET_LABEL_LENGTH = 40;

/** Groups of blocks to pick from; the ids may use `*` for any part of a name. */
export const BLOCK_PRESETS = {
  wood: [
    'minecraft:*_log',
    'minecraft:*_wood',
    'minecraft:crimson_stem',
    'minecraft:warped_stem',
    'minecraft:stripped_crimson_stem',
    'minecraft:stripped_warped_stem',
    'minecraft:crimson_hyphae',
    'minecraft:warped_hyphae',
    'minecraft:stripped_crimson_hyphae',
    'minecraft:stripped_warped_hyphae',
  ],
  stone: [
    'minecraft:stone',
    'minecraft:cobblestone',
    'minecraft:deepslate',
    'minecraft:cobbled_deepslate',
    'minecraft:granite',
    'minecraft:diorite',
    'minecraft:andesite',
    'minecraft:tuff',
  ],
  ores: ['minecraft:*_ore', 'minecraft:ancient_debris'],
  earth: [
    'minecraft:dirt',
    'minecraft:grass_block',
    'minecraft:coarse_dirt',
    'minecraft:podzol',
    'minecraft:mycelium',
    'minecraft:rooted_dirt',
    'minecraft:mud',
  ],
  // Blocks that grow or generate in certain biomes.
  cherry_grove: [
    'minecraft:cherry_log',
    'minecraft:cherry_wood',
    'minecraft:stripped_cherry_log',
    'minecraft:stripped_cherry_wood',
    'minecraft:cherry_leaves',
    'minecraft:cherry_sapling',
    'minecraft:pink_petals',
  ],
  pale_garden: [
    'minecraft:pale_oak_log',
    'minecraft:pale_oak_wood',
    'minecraft:stripped_pale_oak_log',
    'minecraft:stripped_pale_oak_wood',
    'minecraft:pale_oak_leaves',
    'minecraft:pale_moss_block',
    'minecraft:pale_moss_carpet',
    'minecraft:pale_hanging_moss',
    'minecraft:creaking_heart',
    'minecraft:open_eyeblossom',
    'minecraft:closed_eyeblossom',
  ],
  mangrove_swamp: [
    'minecraft:mangrove_log',
    'minecraft:mangrove_wood',
    'minecraft:stripped_mangrove_log',
    'minecraft:stripped_mangrove_wood',
    'minecraft:mangrove_roots',
    'minecraft:muddy_mangrove_roots',
    'minecraft:mangrove_leaves',
    'minecraft:mangrove_propagule',
    'minecraft:mud',
  ],
  jungle: [
    'minecraft:jungle_log',
    'minecraft:jungle_wood',
    'minecraft:stripped_jungle_log',
    'minecraft:stripped_jungle_wood',
    'minecraft:jungle_leaves',
    'minecraft:cocoa',
    'minecraft:melon',
    'minecraft:bamboo',
    'minecraft:bamboo_sapling',
  ],
  desert_badlands: [
    'minecraft:cactus',
    'minecraft:dead_bush',
    'minecraft:suspicious_sand',
    'minecraft:red_sand',
    'minecraft:red_sandstone',
    'minecraft:terracotta',
    'minecraft:*_terracotta',
  ],
  snowy: [
    'minecraft:snow',
    'minecraft:snow_block',
    'minecraft:ice',
    'minecraft:packed_ice',
    'minecraft:blue_ice',
  ],
  mushroom_fields: [
    'minecraft:mycelium',
    'minecraft:brown_mushroom_block',
    'minecraft:red_mushroom_block',
    'minecraft:mushroom_stem',
  ],
  nether_forests: [
    'minecraft:crimson_stem',
    'minecraft:stripped_crimson_stem',
    'minecraft:crimson_hyphae',
    'minecraft:stripped_crimson_hyphae',
    'minecraft:crimson_nylium',
    'minecraft:nether_wart_block',
    'minecraft:weeping_vines',
    'minecraft:weeping_vines_plant',
    'minecraft:shroomlight',
    'minecraft:warped_stem',
    'minecraft:stripped_warped_stem',
    'minecraft:warped_hyphae',
    'minecraft:stripped_warped_hyphae',
    'minecraft:warped_nylium',
    'minecraft:warped_wart_block',
    'minecraft:twisting_vines',
    'minecraft:twisting_vines_plant',
  ],
  nether_terrain: [
    'minecraft:soul_sand',
    'minecraft:soul_soil',
    'minecraft:bone_block',
    'minecraft:basalt',
    'minecraft:blackstone',
    'minecraft:magma_block',
    'minecraft:gilded_blackstone',
    'minecraft:nether_bricks',
    'minecraft:ancient_debris',
  ],
  deep_dark: [
    'minecraft:sculk',
    'minecraft:sculk_vein',
    'minecraft:sculk_sensor',
    'minecraft:sculk_shrieker',
    'minecraft:sculk_catalyst',
    'minecraft:reinforced_deepslate',
  ],
  caves: [
    'minecraft:moss_block',
    'minecraft:moss_carpet',
    'minecraft:azalea',
    'minecraft:flowering_azalea',
    'minecraft:spore_blossom',
    'minecraft:big_dripleaf',
    'minecraft:small_dripleaf',
    'minecraft:cave_vines',
    'minecraft:cave_vines_plant',
    'minecraft:dripstone_block',
    'minecraft:pointed_dripstone',
    'minecraft:glow_lichen',
  ],
  ocean: [
    'minecraft:prismarine',
    'minecraft:prismarine_bricks',
    'minecraft:dark_prismarine',
    'minecraft:sea_lantern',
    'minecraft:sponge',
    'minecraft:kelp',
    'minecraft:kelp_plant',
    'minecraft:sea_pickle',
    'minecraft:*_coral_block',
  ],
  the_end: [
    'minecraft:end_stone',
    'minecraft:chorus_plant',
    'minecraft:chorus_flower',
    'minecraft:purpur_block',
    'minecraft:purpur_pillar',
    'minecraft:end_rod',
  ],
  mountains: ['minecraft:emerald_ore', 'minecraft:deepslate_emerald_ore', 'minecraft:calcite'],
} as const satisfies Record<string, readonly string[]>;
export type BlockPreset = keyof typeof BLOCK_PRESETS;
export const BLOCK_PRESET_IDS = Object.keys(BLOCK_PRESETS) as [BlockPreset, ...BlockPreset[]];

/**
 * The categories of the statistics of a player besides `mined`, as the game names them: what was
 * picked up, killed, crafted, used, broken or dropped, what killed the player, and `custom`
 * counters such as the fish caught.
 */
export const STAT_CATEGORIES = [
  'picked_up',
  'killed',
  'crafted',
  'used',
  'broken',
  'dropped',
  'killed_by',
  'custom',
] as const;
export type StatCategory = (typeof STAT_CATEGORIES)[number];

/** Groups of things to count in a statistic, each for one category. */
export const STAT_PRESETS = {
  ore_drops: {
    category: 'picked_up',
    patterns: [
      'minecraft:raw_copper',
      'minecraft:raw_iron',
      'minecraft:raw_gold',
      'minecraft:coal',
      'minecraft:diamond',
      'minecraft:emerald',
      'minecraft:lapis_lazuli',
      'minecraft:redstone',
      'minecraft:quartz',
      'minecraft:amethyst_shard',
    ],
  },
  crops: {
    category: 'picked_up',
    patterns: [
      'minecraft:wheat',
      'minecraft:carrot',
      'minecraft:potato',
      'minecraft:beetroot',
      'minecraft:nether_wart',
      'minecraft:melon_slice',
      'minecraft:pumpkin',
      'minecraft:sweet_berries',
      'minecraft:glow_berries',
      'minecraft:cocoa_beans',
    ],
  },
  hostile_mobs: {
    category: 'killed',
    patterns: [
      'minecraft:zombie',
      'minecraft:skeleton',
      'minecraft:creeper',
      'minecraft:spider',
      'minecraft:cave_spider',
      'minecraft:enderman',
      'minecraft:witch',
      'minecraft:slime',
      'minecraft:drowned',
      'minecraft:husk',
      'minecraft:stray',
      'minecraft:phantom',
      'minecraft:pillager',
      'minecraft:vindicator',
      'minecraft:evoker',
      'minecraft:ravager',
      'minecraft:blaze',
      'minecraft:ghast',
      'minecraft:magma_cube',
      'minecraft:wither_skeleton',
      'minecraft:guardian',
      'minecraft:shulker',
      'minecraft:silverfish',
      'minecraft:vex',
      'minecraft:zombie_villager',
      'minecraft:zombified_piglin',
      'minecraft:piglin_brute',
      'minecraft:hoglin',
      'minecraft:zoglin',
      'minecraft:breeze',
      'minecraft:bogged',
      'minecraft:creaking',
    ],
  },
  undead: {
    category: 'killed',
    patterns: [
      'minecraft:zombie',
      'minecraft:skeleton',
      'minecraft:zombie_villager',
      'minecraft:husk',
      'minecraft:drowned',
      'minecraft:stray',
      'minecraft:wither_skeleton',
      'minecraft:phantom',
      'minecraft:zombified_piglin',
      'minecraft:bogged',
    ],
  },
  farm_animals: {
    category: 'killed',
    patterns: [
      'minecraft:cow',
      'minecraft:pig',
      'minecraft:sheep',
      'minecraft:chicken',
      'minecraft:rabbit',
    ],
  },
  bosses: {
    category: 'killed',
    patterns: [
      'minecraft:ender_dragon',
      'minecraft:wither',
      'minecraft:elder_guardian',
      'minecraft:warden',
    ],
  },
  mob_kills: { category: 'custom', patterns: ['minecraft:mob_kills'] },
  deaths: { category: 'custom', patterns: ['minecraft:deaths'] },
  animals_bred: { category: 'custom', patterns: ['minecraft:animals_bred'] },
  villager_trades: { category: 'custom', patterns: ['minecraft:traded_with_villager'] },
  jumps: { category: 'custom', patterns: ['minecraft:jump'] },
  enchants: { category: 'custom', patterns: ['minecraft:enchant_item'] },
} as const satisfies Record<string, { category: StatCategory; patterns: readonly string[] }>;
export type StatPreset = keyof typeof STAT_PRESETS;
export const STAT_PRESET_IDS = Object.keys(STAT_PRESETS) as [StatPreset, ...StatPreset[]];

/** The presets of a category. */
export const statPresetsOf = (category: StatCategory): StatPreset[] =>
  STAT_PRESET_IDS.filter((preset) => STAT_PRESETS[preset].category === category);

const ID_PATTERN = /^[a-z0-9_.-]+:[a-z0-9_./*-]+$/;

/** A block or item id, or a pattern, as the counters spell it: lowercase, with `minecraft:`. */
export function normalizeBlockPattern(text: string): string {
  const pattern = text.trim().toLowerCase();
  return pattern.includes(':') || pattern === '' ? pattern : `minecraft:${pattern}`;
}

export const isValidBlockPattern = (text: string) => ID_PATTERN.test(normalizeBlockPattern(text));

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A test for ids from patterns, in which `*` stands for any part of a name. */
export function blockMatcher(patterns: readonly string[]): (id: string) => boolean {
  const expressions = patterns.map(
    (pattern) => new RegExp(`^${pattern.split('*').map(escapeRegExp).join('[a-z0-9_./-]*')}$`),
  );
  return (id) => expressions.some((expression) => expression.test(id));
}

const idListSchema = z
  .array(
    z
      .string()
      .trim()
      .max(100)
      .refine(isValidBlockPattern, { error: 'Use ids like minecraft:oak_log or *_log' }),
  )
  .max(MAX_BLOCKS);

const minedMetricSchema = z.object({
  kind: z.literal('mined'),
  presets: z.array(z.enum(BLOCK_PRESET_IDS)).max(BLOCK_PRESET_IDS.length),
  blocks: idListSchema,
});

/** Fishing catches, as the game counts them (`custom: fish_caught`). */
const fishCaughtMetricSchema = z.object({ kind: z.literal('fish_caught') });

/** Any statistic of the game: what was picked up, killed, crafted, used… */
const statMetricSchema = z.object({
  kind: z.literal('stat'),
  category: z.enum(STAT_CATEGORIES),
  presets: z.array(z.enum(STAT_PRESET_IDS)).max(STAT_PRESET_IDS.length),
  ids: idListSchema,
});

/** What is counted; more kinds can join this list. */
export const metricSchema = z.discriminatedUnion('kind', [
  minedMetricSchema,
  fishCaughtMetricSchema,
  statMetricSchema,
]);
export type Metric = z.infer<typeof metricSchema>;
export const METRIC_KINDS = [
  'mined',
  'fish_caught',
  'stat',
] as const satisfies readonly Metric['kind'][];

/** The patterns of a metric: those of its presets and the ids given. */
export function metricPatterns(metric: Metric): string[] {
  if (metric.kind === 'fish_caught') return ['minecraft:fish_caught'];
  const patterns =
    metric.kind === 'mined'
      ? [...metric.presets.flatMap((preset) => BLOCK_PRESETS[preset]), ...metric.blocks]
      : [
          ...metric.presets.flatMap((preset) =>
            STAT_PRESETS[preset].category === metric.category ? STAT_PRESETS[preset].patterns : [],
          ),
          ...metric.ids,
        ];
  return [...new Set(patterns.map(normalizeBlockPattern))];
}

/** The category of the statistics a metric reads. */
export function metricCategory(metric: Metric): 'mined' | StatCategory {
  return metric.kind === 'mined'
    ? 'mined'
    : metric.kind === 'fish_caught'
      ? 'custom'
      : metric.category;
}

/** Whether a metric says what it counts, and its presets fit its category. */
export function metricProblem(metric: Metric): 'empty' | 'presets' | null {
  if (metric.kind === 'stat') {
    if (metric.presets.some((preset) => STAT_PRESETS[preset].category !== metric.category)) {
      return 'presets';
    }
  }
  return metricPatterns(metric).length === 0 ? 'empty' : null;
}

/** What one counter of a metric adds up: the category to read and which of its ids count. */
export function selectorOf(metric: Metric): {
  category: string;
  matches: (id: string) => boolean;
} {
  return { category: metricCategory(metric), matches: blockMatcher(metricPatterns(metric)) };
}

// --- Goals ------------------------------------------------------------------------------------

/** One thing to do: reach an amount of a counter. */
export const targetSchema = z.object({
  /** What players read in their progress, e.g. "Spruce logs". */
  label: z
    .string()
    .trim()
    .min(1)
    .max(MAX_TARGET_LABEL_LENGTH)
    .regex(/^[^\r\n&{}]+$/, { error: 'Letters and digits, no & { }' }),
  metric: metricSchema,
  amount: z.number().int().min(1).max(MAX_TARGET_AMOUNT),
});
export type Target = z.infer<typeof targetSchema>;

/** How a counter becomes a result; more kinds can join this list. */
export const scoringSchema = z.discriminatedUnion('kind', [
  /** What the counter grew by from the start to the end, and the highest wins. */
  z.object({ kind: z.literal('sum') }),
  /** Every target reached by growing its counter; whoever reaches all of them is rewarded. */
  z.object({
    kind: z.literal('targets'),
    targets: z.array(targetSchema).min(1).max(MAX_TARGETS),
  }),
]);
export type Scoring = z.infer<typeof scoringSchema>;
