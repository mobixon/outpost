import { describe, expect, it } from 'vitest';
import { Names } from './names.js';
import { readNbt } from './nbt.js';
import { readAdvancements, readPlayer, readStats } from './player.js';
import {
  byte,
  double,
  float,
  int,
  intArray,
  list,
  short,
  writeNbt,
  type NbtInput,
} from './testing.js';

const names = new Names({
  'item.minecraft.netherite_sword': 'Netherite Sword',
  'item.minecraft.potion.effect.healing': 'Potion of Healing',
  'block.minecraft.stone': 'Stone',
  'enchantment.minecraft.sharpness': 'Sharpness',
  'enchantment.minecraft.mending': 'Mending',
  'enchantment.level.5': 'V',
  'entity.minecraft.zombie': 'Zombie',
  'stat.minecraft.play_time': 'Time Played',
  'advancements.story.mine_stone.title': 'Stone Age',
});
const read = (data: { [name: string]: NbtInput }, withLocation = true) =>
  readPlayer(readNbt(writeNbt(data)), names, withLocation);

// A player as Minecraft 26.2 saves them (item components, equipment, respawn).
const MODERN: { [name: string]: NbtInput } = {
  DataVersion: int(4903),
  Inventory: [
    {
      Slot: byte(0),
      id: 'minecraft:netherite_sword',
      count: int(1),
      components: {
        'minecraft:enchantments': { 'minecraft:sharpness': int(5), 'minecraft:mending': int(1) },
        'minecraft:damage': int(100),
        'minecraft:custom_name': 'Excalibur',
      },
    },
    { Slot: byte(9), id: 'minecraft:torch', count: int(29) },
    {
      Slot: byte(10),
      id: 'minecraft:red_shulker_box',
      count: int(1),
      components: {
        'minecraft:container': [
          { slot: int(0), item: { id: 'minecraft:diamond', count: int(64) } },
          {
            slot: int(26),
            item: {
              id: 'minecraft:potion',
              count: int(1),
              components: { 'minecraft:potion_contents': { potion: 'minecraft:strong_healing' } },
            },
          },
        ],
      },
    },
    {
      Slot: byte(11),
      id: 'minecraft:bundle',
      count: int(1),
      components: { 'minecraft:bundle_contents': [{ id: 'minecraft:stick', count: int(3) }] },
    },
  ],
  equipment: {
    head: {
      id: 'minecraft:netherite_helmet',
      count: int(1),
      components: { 'minecraft:damage': int(7) },
    },
    offhand: { id: 'minecraft:shield', count: int(1) },
  },
  EnderItems: [
    {
      Slot: byte(3),
      id: 'minecraft:enchanted_book',
      count: int(1),
      components: { 'minecraft:stored_enchantments': { 'minecraft:silk_touch': int(1) } },
    },
  ],
  Pos: list(6, [double(-809.25), double(79), double(-1473.5)]),
  Dimension: 'minecraft:overworld',
  respawn: { pos: intArray([-799, 71, -1472]), dimension: 'minecraft:overworld' },
  LastDeathLocation: { pos: intArray([-1432, -35, 139]), dimension: 'minecraft:the_nether' },
  playerGameType: int(0),
  Health: float(20),
  foodLevel: int(19),
  XpLevel: int(17),
  XpP: float(0.5),
  SelectedItemSlot: int(8),
};

describe('readPlayer', () => {
  it('reads the inventory, equipment and ender chest of Minecraft 26.x', () => {
    const player = read(MODERN);
    expect(player).toMatchObject({
      gameMode: 'survival',
      health: 20,
      food: 19,
      xpLevel: 17,
      xpProgress: 0.5,
      selectedSlot: 8,
    });
    expect(player.inventory.map((item) => [item.slot, item.id])).toEqual([
      [0, 'minecraft:netherite_sword'],
      [9, 'minecraft:torch'],
      [10, 'minecraft:red_shulker_box'],
      [11, 'minecraft:bundle'],
    ]);
    expect(player.inventory[0]).toEqual({
      slot: 0,
      id: 'minecraft:netherite_sword',
      count: 1,
      label: 'Netherite Sword',
      customName: 'Excalibur',
      enchantments: [
        { id: 'minecraft:sharpness', label: 'Sharpness V' },
        { id: 'minecraft:mending', label: 'Mending' },
      ],
      damage: 100,
      maxDamage: 2031,
      icon: 'minecraft:netherite_sword',
      contents: null,
    });
    expect(player.inventory[1]).toMatchObject({ label: 'Torch', count: 29, damage: null });
    expect(player.inventory[2]?.contents).toMatchObject([
      { slot: 0, id: 'minecraft:diamond', count: 64, label: 'Diamond' },
      { slot: 26, id: 'minecraft:potion', label: 'Potion of Healing' },
    ]);
    expect(player.inventory[3]?.contents).toMatchObject([
      { slot: 0, id: 'minecraft:stick', count: 3 },
    ]);
    expect(player.armor).toMatchObject({
      head: { id: 'minecraft:netherite_helmet', damage: 7, maxDamage: 407 },
      chest: null,
      legs: null,
      feet: null,
    });
    expect(player.offhand).toMatchObject({ id: 'minecraft:shield', damage: 0, maxDamage: 336 });
    expect(player.enderChest).toMatchObject([
      { slot: 3, id: 'minecraft:enchanted_book', enchantments: [{ label: 'Silk Touch' }] },
    ]);
    expect(player.location).toEqual({
      position: { x: -809.25, y: 79, z: -1473.5, dimension: 'minecraft:overworld' },
      respawn: { x: -799, y: 71, z: -1472, dimension: 'minecraft:overworld' },
      lastDeath: { x: -1432, y: -35, z: 139, dimension: 'minecraft:the_nether' },
    });
  });

  it('leaves out the location without the permission', () => {
    expect(read(MODERN, false).location).toBeNull();
  });

  it('reads the formats before 1.20.5 and 1.21.5', () => {
    const player = read({
      Inventory: [
        {
          Slot: byte(0),
          id: 'minecraft:diamond_pickaxe',
          Count: byte(1),
          tag: {
            Damage: int(3),
            Enchantments: [{ id: 'minecraft:efficiency', lvl: short(5) }],
            display: { Name: '{"text":"Digger","extra":[{"text":" 2"}]}' },
          },
        },
        {
          Slot: byte(1),
          id: 'minecraft:shulker_box',
          Count: byte(1),
          tag: {
            BlockEntityTag: { Items: [{ Slot: byte(4), id: 'minecraft:apple', Count: byte(5) }] },
          },
        },
        { Slot: byte(103), id: 'minecraft:iron_helmet', Count: byte(1) },
        { Slot: byte(100), id: 'minecraft:iron_boots', Count: byte(1) },
        { Slot: byte(-106), id: 'minecraft:totem_of_undying', Count: byte(1) },
      ],
      Pos: list(6, [double(1.5), double(64), double(-2.5)]),
      Dimension: int(-1),
      SpawnX: int(1),
      SpawnY: int(64),
      SpawnZ: int(-2),
      SpawnDimension: 'minecraft:overworld',
    });
    expect(player.inventory[0]).toMatchObject({
      customName: 'Digger 2',
      damage: 3,
      maxDamage: 1561,
      enchantments: [{ id: 'minecraft:efficiency', label: 'Efficiency V' }],
    });
    expect(player.inventory[1]?.contents).toMatchObject([
      { slot: 4, id: 'minecraft:apple', count: 5 },
    ]);
    expect(player.armor).toMatchObject({
      head: { id: 'minecraft:iron_helmet', slot: 0, maxDamage: 165 },
      feet: { id: 'minecraft:iron_boots', maxDamage: 195 },
    });
    expect(player.offhand).toMatchObject({ id: 'minecraft:totem_of_undying', damage: null });
    expect(player.location).toEqual({
      position: { x: 1.5, y: 64, z: -2.5, dimension: 'minecraft:the_nether' },
      respawn: { x: 1, y: 64, z: -2, dimension: 'minecraft:overworld' },
      lastDeath: null,
    });
  });
});

describe('readStats', () => {
  it('picks the main statistics and the ten largest of each kind', () => {
    const stats = readStats(
      {
        stats: {
          'minecraft:custom': {
            'minecraft:walk_one_cm': 123456,
            'minecraft:play_time': 72000,
            'minecraft:deaths': 3,
            'minecraft:leave_game': 9,
          },
          'minecraft:mined': { 'minecraft:stone': 10, 'minecraft:dirt': 30 },
          'minecraft:killed': { 'minecraft:zombie': 5 },
        },
        DataVersion: 4903,
      },
      names,
    );
    expect(stats).toEqual({
      custom: [
        { key: 'play_time', label: 'Time Played', value: 72000 },
        { key: 'deaths', label: 'Deaths', value: 3 },
        { key: 'walk_one_cm', label: 'Walk One Cm', value: 123456 },
      ],
      mined: [
        { key: 'minecraft:dirt', label: 'Dirt', value: 30 },
        { key: 'minecraft:stone', label: 'Stone', value: 10 },
      ],
      used: [],
      crafted: [],
      killed: [{ key: 'minecraft:zombie', label: 'Zombie', value: 5 }],
      killedBy: [],
    });
  });

  it('takes the play time of versions before 1.17 and refuses other formats', () => {
    const stats = readStats(
      { stats: { 'minecraft:custom': { 'minecraft:play_one_minute': 20 } } },
      names,
    );
    expect(stats?.custom).toEqual([{ key: 'play_time', label: 'Time Played', value: 20 }]);
    expect(readStats({ 'stat.playOneMinute': 20 }, names)).toBeNull();
  });
});

describe('readAdvancements', () => {
  it('lists the advancements made, without recipes, the last one first', () => {
    expect(
      readAdvancements(
        {
          'minecraft:story/root': {
            criteria: { crafting_table: '2026-09-05 10:00:00 +0200' },
            done: true,
          },
          'minecraft:story/mine_stone': {
            criteria: { get_stone: '2026-09-06 13:59:20 +0000' },
            done: true,
          },
          'minecraft:recipes/misc/charcoal': {
            criteria: { has: '2026-09-06 13:00:00 +0000' },
            done: true,
          },
          'minecraft:adventure/adventuring_time': { criteria: {}, done: false },
          DataVersion: 4903,
        },
        names,
      ),
    ).toEqual([
      { id: 'minecraft:story/mine_stone', title: 'Stone Age', doneAt: '2026-09-06T13:59:20.000Z' },
      { id: 'minecraft:story/root', title: 'Root', doneAt: '2026-09-05T08:00:00.000Z' },
    ]);
  });
});
