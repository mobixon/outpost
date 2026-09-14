import { describe, expect, it } from 'vitest';
import { Names, prettify } from './names.js';

describe('Names', () => {
  const names = new Names(
    { 'item.minecraft.diamond_sword': 'Алмазный меч', 'enchantment.level.3': 'III' },
    {
      'item.minecraft.diamond_sword': 'Diamond Sword',
      'block.minecraft.stone': 'Stone',
      'enchantment.minecraft.unbreaking': 'Unbreaking',
      'item.minecraft.splash_potion.effect.healing': 'Splash Potion of Healing',
      'advancements.nether.find_fortress.title': 'A Terrible Fortress',
    },
  );

  it('name items and blocks, in the language first and in English otherwise', () => {
    expect(names.item('minecraft:diamond_sword')).toBe('Алмазный меч');
    expect(names.item('minecraft:stone')).toBe('Stone');
    expect(names.item('phoenix:slot_machine')).toBe('Slot Machine');
  });

  it('name potions by their effect, also strong and long ones', () => {
    expect(names.item('minecraft:splash_potion', 'minecraft:strong_healing')).toBe(
      'Splash Potion of Healing',
    );
    expect(names.item('minecraft:potion', 'minecraft:water')).toBe('Potion');
  });

  it('show enchantment levels, but not for enchantments with one level', () => {
    expect(names.enchantment('minecraft:unbreaking', 3)).toBe('Unbreaking III');
    expect(names.enchantment('minecraft:mending', 1)).toBe('Mending');
    expect(names.enchantment('minecraft:sharpness', 10)).toBe('Sharpness 10');
  });

  it('name advancements by their title', () => {
    expect(names.advancement('minecraft:nether/find_fortress')).toBe('A Terrible Fortress');
    expect(names.advancement('minecraft:story/mine_stone')).toBe('Mine Stone');
  });

  it('prettify ids without a name', () => {
    expect(prettify('minecraft:walk_one_cm')).toBe('Walk One Cm');
    expect(prettify('minecraft:story/root')).toBe('Root');
  });
});
