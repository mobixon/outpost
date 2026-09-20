import { describe, expect, it } from 'vitest';
import {
  BLOCK_PRESETS,
  blockMatcher,
  metricCategory,
  metricPatterns,
  metricProblem,
  selectorOf,
  STAT_PRESET_IDS,
  STAT_PRESETS,
  statPresetsOf,
  type Metric,
  type StatPreset,
} from './metrics.js';

const killed = (presets: StatPreset[], ids: string[] = []): Metric => ({
  kind: 'stat',
  category: 'killed',
  presets,
  ids,
});

describe('metrics', () => {
  it('read the category of the statistics that they count', () => {
    expect(metricCategory({ kind: 'mined', presets: [], blocks: [] })).toBe('mined');
    expect(metricCategory({ kind: 'fish_caught' })).toBe('custom');
    expect(metricCategory(killed(['bosses']))).toBe('killed');
  });

  it('turn presets and ids into patterns that match the counters of the game', () => {
    const drops = selectorOf({
      kind: 'stat',
      category: 'picked_up',
      presets: ['ore_drops'],
      ids: ['Cherry_Log'],
    });
    expect(drops.category).toBe('picked_up');
    for (const id of ['minecraft:raw_copper', 'minecraft:diamond', 'minecraft:cherry_log']) {
      expect(drops.matches(id)).toBe(true);
    }
    // The ore itself is a block, not a drop.
    expect(drops.matches('minecraft:copper_ore')).toBe(false);
    expect(selectorOf({ kind: 'fish_caught' })).toMatchObject({ category: 'custom' });
    expect(selectorOf({ kind: 'fish_caught' }).matches('minecraft:fish_caught')).toBe(true);
  });

  it('ignore the presets of another category', () => {
    const metric: Metric = { kind: 'stat', category: 'killed', presets: ['ore_drops'], ids: [] };
    expect(metricPatterns(metric)).toEqual([]);
    expect(metricProblem(metric)).toBe('presets');
    expect(metricProblem(killed([]))).toBe('empty');
    expect(metricProblem(killed(['undead']))).toBeNull();
    expect(metricProblem(killed([], ['minecraft:cow']))).toBeNull();
  });

  it('group the presets by their category', () => {
    expect(statPresetsOf('killed')).toEqual(['hostile_mobs', 'undead', 'farm_animals', 'bosses']);
    expect(statPresetsOf('picked_up')).toEqual(['ore_drops', 'crops']);
    expect(statPresetsOf('used')).toEqual([]);
    for (const preset of STAT_PRESET_IDS) {
      expect(STAT_PRESETS[preset].patterns.length).toBeGreaterThan(0);
    }
  });

  it('have block presets for the biomes, with ids in the namespace of the game', () => {
    for (const [name, patterns] of Object.entries(BLOCK_PRESETS)) {
      for (const pattern of patterns) {
        expect(pattern, name).toMatch(/^minecraft:[a-z0-9_*]+$/);
      }
    }
    const desert = blockMatcher([...BLOCK_PRESETS.desert_badlands]);
    expect(desert('minecraft:cactus')).toBe(true);
    expect(desert('minecraft:orange_terracotta')).toBe(true);
    expect(desert('minecraft:oak_log')).toBe(false);
    expect(blockMatcher([...BLOCK_PRESETS.ocean])('minecraft:brain_coral_block')).toBe(true);
    expect(blockMatcher([...BLOCK_PRESETS.pale_garden])('minecraft:creaking_heart')).toBe(true);
  });
});
