import { describe, expect, it } from 'vitest';
import { normalizeUuid, parseOps, parseStats, parseUserCache } from './minecraft-files.js';

const UUID = '069A79F4-44E9-4726-A5BE-FCA90E38AAF5';

describe('parseStats', () => {
  it('reads the counters by category without the prefix', () => {
    expect(
      parseStats({
        stats: {
          'minecraft:mined': { 'minecraft:oak_log': 12, 'minecraft:stone': 3, bad: 'x' },
          'minecraft:custom': { 'minecraft:play_time': 100 },
          broken: 5,
        },
        DataVersion: 4000,
      }),
    ).toEqual({
      mined: { 'minecraft:oak_log': 12, 'minecraft:stone': 3 },
      custom: { 'minecraft:play_time': 100 },
    });
  });

  it('refuses other formats', () => {
    expect(parseStats(null)).toBe(null);
    expect(parseStats([])).toBe(null);
    expect(parseStats({ stats: 1 })).toBe(null);
  });
});

describe('player lists', () => {
  it('read names and UUIDs', () => {
    expect(normalizeUuid(UUID)).toBe(UUID.toLowerCase());
    expect(normalizeUuid('nope')).toBe(null);
    const json = [
      { name: 'Steve', uuid: UUID, level: 4 },
      { name: 'NoUuid' },
      { name: 'BadUuid', uuid: 'x' },
    ];
    expect(parseOps(json)).toEqual([{ name: 'Steve', uuid: UUID.toLowerCase() }]);
    expect(parseUserCache(json)).toHaveLength(1);
    expect(parseOps({})).toBe(null);
  });
});
