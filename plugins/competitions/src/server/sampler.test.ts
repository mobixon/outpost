import type { PlayerStats, PluginContext } from '@outpost/plugin-api';
import { describe, expect, it } from 'vitest';
import type { Metric } from '../shared.js';
import { Sampler } from './sampler.js';

const STEVE = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
const ALEX = '61699b2e-d327-3a92-a2bb-67c4ca2c2d00';

/** A server whose statistics are read from a map; `reads` counts the files that were read. */
function setUp(initial: Record<string, PlayerStats>) {
  const files = new Map(Object.entries(initial));
  const modified = new Map<string, number>();
  const reads: string[] = [];
  const ctx = {
    stats: {
      list: async () =>
        [...files.keys()].map((uuid) => ({
          uuid,
          modifiedAt: new Date(modified.get(uuid) ?? 1000),
        })),
      read: async (_serverId: string, uuid: string) => {
        reads.push(uuid);
        return files.get(uuid) ?? null;
      },
    },
  } as unknown as PluginContext;
  return {
    sampler: new Sampler(ctx),
    reads,
    write: (uuid: string, stats: PlayerStats, time: number) => {
      files.set(uuid, stats);
      modified.set(uuid, time);
    },
  };
}

const wood: Metric = { kind: 'mined', presets: ['wood'], blocks: [] };
const fish: Metric = { kind: 'fish_caught' };

describe('Sampler', () => {
  it('adds up the mined blocks that match the metric', async () => {
    const { sampler } = setUp({
      [STEVE]: {
        mined: { 'minecraft:oak_log': 3, 'minecraft:birch_log': 4, 'minecraft:stone': 99 },
      },
      [ALEX]: { custom: { 'minecraft:fish_caught': 7 } },
    });
    expect(Object.fromEntries(await sampler.measure('s1', 'e1', wood))).toEqual({
      [STEVE]: 7,
      [ALEX]: 0,
    });
  });

  it('counts the fish caught, not the blocks', async () => {
    const { sampler } = setUp({
      [STEVE]: { mined: { 'minecraft:oak_log': 3 }, custom: { 'minecraft:fish_caught': 12 } },
      [ALEX]: { mined: { 'minecraft:oak_log': 3 } },
    });
    expect(Object.fromEntries(await sampler.measure('s1', 'e1', fish))).toEqual({
      [STEVE]: 12,
      [ALEX]: 0,
    });
  });

  it('reads again only the files that changed, unless asked for fresh ones', async () => {
    const { sampler, reads, write } = setUp({
      [STEVE]: { custom: { 'minecraft:fish_caught': 1 } },
      [ALEX]: { custom: { 'minecraft:fish_caught': 2 } },
    });
    await sampler.measure('s1', 'e1', fish);
    reads.length = 0;
    write(STEVE, { custom: { 'minecraft:fish_caught': 5 } }, 2000);
    expect(Object.fromEntries(await sampler.measure('s1', 'e1', fish))).toEqual({
      [STEVE]: 5,
      [ALEX]: 2,
    });
    expect(reads).toEqual([STEVE]);
    reads.length = 0;
    await sampler.measure('s1', 'e1', fish, { fresh: true });
    expect(reads.sort()).toEqual([ALEX, STEVE].sort());
  });
});
