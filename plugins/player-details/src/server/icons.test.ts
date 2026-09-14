import { describe, expect, it } from 'vitest';
import { modelRefOf, resolveIcons, texturesOf } from './icons.js';

// Excerpts of the Minecraft 26.2 client.
const CLIENT: Record<string, unknown> = {
  'items/diamond_sword.json': {
    model: { type: 'minecraft:model', model: 'minecraft:item/diamond_sword' },
  },
  'models/item/diamond_sword.json': {
    parent: 'minecraft:item/handheld',
    textures: { layer0: 'minecraft:item/diamond_sword' },
  },
  'models/item/handheld.json': { parent: 'item/generated' },
  'models/item/generated.json': { parent: 'builtin/generated' },
  'items/potion.json': {
    model: {
      type: 'minecraft:model',
      model: 'minecraft:item/potion',
      tints: [{ type: 'minecraft:potion', default: -13083194 }],
    },
  },
  'models/item/potion.json': {
    parent: 'minecraft:item/generated',
    textures: { layer0: 'minecraft:item/potion_overlay', layer1: 'minecraft:item/potion' },
  },
  'items/oak_leaves.json': {
    model: {
      type: 'minecraft:model',
      model: 'minecraft:block/oak_leaves',
      tints: [{ type: 'minecraft:constant', value: -12012264 }],
    },
  },
  'models/block/oak_leaves.json': {
    parent: 'minecraft:block/leaves',
    textures: { all: 'minecraft:block/oak_leaves' },
  },
  'models/block/leaves.json': { parent: 'block/cube_all' },
  'models/block/cube_all.json': {
    parent: 'block/cube',
    textures: { particle: '#all', up: '#all', north: '#all', east: '#all' },
  },
  'models/block/cube.json': { parent: 'block/block' },
  'models/block/block.json': {},
  'items/grass_block.json': {
    model: {
      type: 'minecraft:model',
      model: 'minecraft:block/grass_block',
      tints: [{ type: 'minecraft:grass', downfall: 1, temperature: 0.5 }],
    },
  },
  'models/block/grass_block.json': {
    parent: 'block/block',
    textures: {
      particle: 'block/dirt',
      bottom: 'block/dirt',
      top: 'block/grass_block_top',
      side: 'block/grass_block_side',
    },
  },
  'items/furnace.json': { model: { type: 'minecraft:model', model: 'minecraft:block/furnace' } },
  'models/block/furnace.json': {
    parent: 'minecraft:block/orientable',
    textures: {
      front: 'minecraft:block/furnace_front',
      side: 'minecraft:block/furnace_side',
      top: 'minecraft:block/furnace_top',
    },
  },
  'models/block/orientable.json': {
    parent: 'block/orientable_with_bottom',
    textures: { bottom: '#top' },
  },
  'models/block/orientable_with_bottom.json': {
    parent: 'block/cube',
    textures: { particle: '#front', down: '#bottom', up: '#top', north: '#front', east: '#side' },
  },
  'items/shulker_box.json': {
    model: {
      type: 'minecraft:special',
      base: 'minecraft:item/shulker_box',
      model: { type: 'minecraft:shulker_box', texture: 'minecraft:shulker' },
    },
  },
  'models/item/shulker_box.json': {
    parent: 'minecraft:item/template_shulker_box',
    textures: { particle: 'minecraft:block/shulker_box' },
  },
  'models/item/template_shulker_box.json': {},
  'items/chest.json': {
    model: {
      type: 'minecraft:select',
      cases: [],
      fallback: {
        type: 'minecraft:special',
        base: 'minecraft:item/chest',
        model: { type: 'minecraft:chest' },
      },
    },
  },
  'models/item/chest.json': {
    parent: 'minecraft:item/template_chest',
    textures: { particle: 'minecraft:block/oak_planks' },
  },
  'items/bow.json': {
    model: {
      type: 'minecraft:condition',
      on_false: { type: 'minecraft:model', model: 'minecraft:item/bow' },
      on_true: { type: 'minecraft:model', model: 'minecraft:item/bow_pulling_0' },
    },
  },
  'models/item/bow.json': { parent: 'item/generated', textures: { layer0: 'item/bow' } },
};
const read = (path: string) => Promise.resolve(CLIENT[path.replace(/^assets\/minecraft\//, '')]);

describe('icons from the client models', () => {
  it('draw items as their texture layers, with tints', async () => {
    const icons = await resolveIcons(read, ['diamond_sword', 'potion', 'bow'], true);
    expect(icons['minecraft:diamond_sword']).toEqual({
      kind: 'flat',
      layers: [{ texture: 'item/diamond_sword', tint: null }],
    });
    expect(icons['minecraft:potion']).toEqual({
      kind: 'flat',
      layers: [
        { texture: 'item/potion_overlay', tint: 0x385dc6 },
        { texture: 'item/potion', tint: null },
      ],
    });
    expect(icons['minecraft:bow']).toMatchObject({ layers: [{ texture: 'item/bow' }] });
  });

  it('draw blocks as cubes, tinting leaves all over and grass on the top', async () => {
    const icons = await resolveIcons(read, ['oak_leaves', 'grass_block', 'furnace'], true);
    const leaves = { texture: 'block/oak_leaves', tint: 0x48b518 };
    expect(icons['minecraft:oak_leaves']).toEqual({
      kind: 'cube',
      top: leaves,
      left: leaves,
      right: leaves,
    });
    expect(icons['minecraft:grass_block']).toEqual({
      kind: 'cube',
      top: { texture: 'block/grass_block_top', tint: 0x79c05a },
      left: { texture: 'block/grass_block_side', tint: null },
      right: { texture: 'block/grass_block_side', tint: null },
    });
    const furnace = icons['minecraft:furnace'];
    expect(furnace && texturesOf(furnace)).toEqual([
      'block/furnace_top',
      'block/furnace_front',
      'block/furnace_side',
    ]);
  });

  it('use the particle texture for special items, but not planks', async () => {
    const icons = await resolveIcons(read, ['shulker_box', 'chest', 'missing'], true);
    expect(icons).toEqual({
      'minecraft:shulker_box': {
        kind: 'flat',
        layers: [{ texture: 'block/shulker_box', tint: null }],
      },
    });
  });

  it('read item models directly for clients before 1.21.4', async () => {
    const icons = await resolveIcons(read, ['diamond_sword'], false);
    expect(Object.keys(icons)).toEqual(['minecraft:diamond_sword']);
  });

  it('find the default model of every kind of item definition', () => {
    const model = (name: string) => ({ type: 'minecraft:model', model: name });
    expect(
      modelRefOf({
        type: 'minecraft:range_dispatch',
        entries: [{ model: model('item/compass_16'), threshold: 0 }],
      })?.model,
    ).toBe('item/compass_16');
    expect(
      modelRefOf({
        type: 'minecraft:composite',
        models: [{ type: 'unknown' }, model('block/red_bed')],
      })?.model,
    ).toBe('block/red_bed');
    expect(modelRefOf({ type: 'minecraft:bundle/selected_item' })).toBeNull();
  });

  it('give heads no icon rather than soul sand', async () => {
    const client: Record<string, unknown> = {
      'assets/minecraft/items/player_head.json': {
        model: { type: 'minecraft:special', base: 'minecraft:item/template_skull' },
      },
      'assets/minecraft/models/item/template_skull.json': {
        textures: { particle: 'minecraft:block/soul_sand' },
      },
    };
    const icons = await resolveIcons(
      (path) => Promise.resolve(client[path]),
      ['player_head'],
      true,
    );
    expect(icons).toEqual({});
  });
});
