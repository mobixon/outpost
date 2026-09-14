import { z } from 'zod';

export const PLAYER_DETAILS_PLUGIN_ID = 'outpost.player-details';

export const PlayerDetailsPermission = {
  /** See the inventories, ender chests, statistics and advancements of the players. */
  view: 'player-details.view',
  /** See where the players are, where they respawn and where they died. */
  location: 'player-details.location',
} as const;

/** Languages of the item names Outpost downloads with the icons. */
export const nameLocaleSchema = z.enum(['en', 'ru']);
export type NameLocale = z.infer<typeof nameLocaleSchema>;

export const assetsSchema = z.object({
  /** The Minecraft version of the world (from level.dat); null when it cannot be read. */
  version: z.string().nullable(),
  /** Item icons and names of that version: not downloaded, downloading, ready or failed. */
  state: z.enum(['missing', 'downloading', 'ready', 'failed']),
  /** Why the last download failed, e.g. `version_unknown`. */
  error: z.string().nullable(),
});
export type Assets = z.infer<typeof assetsSchema>;

/** Downloading the icons from Mojang needs the owner to accept the Minecraft EULA. */
export const downloadRequestSchema = z.object({ acceptEula: z.literal(true) });

export const playerSummarySchema = z.object({
  uuid: z.string(),
  /** From usercache.json; null when the server does not know the name. */
  name: z.string().nullable(),
  /** When the server last saved the player: when they left, or at an autosave. */
  savedAt: z.string(),
});
export type PlayerSummary = z.infer<typeof playerSummarySchema>;

export const playerListSchema = z.object({
  players: z.array(playerSummarySchema),
  assets: assetsSchema,
});

const itemFields = {
  /** The slot in its container: 0–8 hotbar, 9–35 inventory; 0 for armor. */
  slot: z.number().int(),
  id: z.string(),
  count: z.number().int(),
  /** The name of the kind of item, translated when the names are downloaded. */
  label: z.string(),
  /** A name given in an anvil. */
  customName: z.string().nullable(),
  enchantments: z.array(z.object({ id: z.string(), label: z.string() })),
  /** Durability used and in total; null for items that do not wear out. */
  damage: z.number().int().nullable(),
  maxDamage: z.number().int().nullable(),
  /** The item whose icon to show (`minecraft:item_model`), usually `id`. */
  icon: z.string(),
};
export const storedItemSchema = z.object(itemFields);
export type StoredItem = z.infer<typeof storedItemSchema>;

export const itemSchema = z.object({
  ...itemFields,
  /** What a shulker box or a bundle holds; null for other items. */
  contents: z.array(storedItemSchema).nullable(),
});
export type Item = z.infer<typeof itemSchema>;

const iconLayerSchema = z.object({
  texture: z.string(),
  /** RGB colour the texture is multiplied with, as the game tints leaves or potions. */
  tint: z.number().int().nullable(),
});
export type IconLayer = z.infer<typeof iconLayerSchema>;

/** How to draw an item: flat layers of textures, or a block as a cube. */
export const iconSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('flat'), layers: z.array(iconLayerSchema) }),
  z.object({
    kind: z.literal('cube'),
    top: iconLayerSchema,
    left: iconLayerSchema,
    right: iconLayerSchema,
  }),
]);
export type Icon = z.infer<typeof iconSchema>;

const placeSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  /** e.g. `minecraft:overworld`. */
  dimension: z.string(),
});
export type Place = z.infer<typeof placeSchema>;

export const statSchema = z.object({ key: z.string(), label: z.string(), value: z.number() });
export type Stat = z.infer<typeof statSchema>;

export const playerStatsSchema = z.object({
  /** Play time, deaths, distances and more (`minecraft:custom`). */
  custom: z.array(statSchema),
  /** The ten largest of each kind. */
  mined: z.array(statSchema),
  used: z.array(statSchema),
  crafted: z.array(statSchema),
  killed: z.array(statSchema),
  killedBy: z.array(statSchema),
});
export type PlayerStats = z.infer<typeof playerStatsSchema>;

export const playerDetailSchema = z.object({
  uuid: z.string(),
  name: z.string().nullable(),
  savedAt: z.string(),
  gameMode: z.enum(['survival', 'creative', 'adventure', 'spectator']).nullable(),
  health: z.number().nullable(),
  food: z.number().nullable(),
  xpLevel: z.number().int().nullable(),
  /** Progress to the next level, 0–1. */
  xpProgress: z.number().nullable(),
  /** The selected hotbar slot, 0–8. */
  selectedSlot: z.number().int().nullable(),
  inventory: z.array(itemSchema),
  armor: z.object({
    head: itemSchema.nullable(),
    chest: itemSchema.nullable(),
    legs: itemSchema.nullable(),
    feet: itemSchema.nullable(),
  }),
  offhand: itemSchema.nullable(),
  enderChest: z.array(itemSchema),
  /** Only for users who may see locations. */
  location: z
    .object({
      position: placeSchema.nullable(),
      respawn: placeSchema.nullable(),
      lastDeath: placeSchema.nullable(),
    })
    .nullable(),
  stats: playerStatsSchema.nullable(),
  advancements: z
    .array(z.object({ id: z.string(), title: z.string(), doneAt: z.string().nullable() }))
    .nullable(),
  /** Icons of the items shown, by `icon` of the items, and the textures they use. */
  icons: z.record(z.string(), iconSchema),
  textures: z.record(z.string(), z.string()),
  assets: assetsSchema,
});
export type PlayerDetail = z.infer<typeof playerDetailSchema>;
