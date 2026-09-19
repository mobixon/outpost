import { describe, expect, it } from 'vitest';
import {
  blockMatcher,
  defaultMessages,
  eventInputSchema,
  metricPatterns,
  normalizeBlockPattern,
} from './shared.js';

const input = () => ({
  name: 'Wood week',
  timezone: 'Europe/Berlin',
  startsAt: '2026-09-20T10:00:00Z',
  endsAt: '2026-09-27T10:00:00Z',
  metric: { kind: 'mined' as const, presets: ['wood' as const], blocks: [] },
  scoring: { kind: 'sum' as const },
  participants: { top: 3, excludeOperators: true, excluded: [] },
  rewards: { places: [{ place: 1, commands: ['give {player} diamond {score}'] }] },
  messages: defaultMessages(),
});
const problems = (value: object) => {
  const result = eventInputSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('blocks', () => {
  const wood = blockMatcher(metricPatterns({ kind: 'mined', presets: ['wood'], blocks: [] }));

  it('match the presets by pattern, so that new kinds of wood count', () => {
    expect(wood('minecraft:oak_log')).toBe(true);
    expect(wood('minecraft:pale_oak_log')).toBe(true);
    expect(wood('minecraft:stripped_cherry_wood')).toBe(true);
    expect(wood('minecraft:crimson_stem')).toBe(true);
    // Stems of crops are not wood, and nothing else may match by accident.
    expect(wood('minecraft:melon_stem')).toBe(false);
    expect(wood('minecraft:oak_planks')).toBe(false);
    expect(wood('other:oak_log')).toBe(false);
  });

  it('take custom ids with and without the namespace', () => {
    expect(normalizeBlockPattern(' Cherry_Log ')).toBe('minecraft:cherry_log');
    expect(normalizeBlockPattern('mod:thing')).toBe('mod:thing');
    const custom = blockMatcher(
      metricPatterns({ kind: 'mined', presets: ['ores'], blocks: ['cherry_log'] }),
    );
    expect(custom('minecraft:deepslate_diamond_ore')).toBe(true);
    expect(custom('minecraft:cherry_log')).toBe(true);
    expect(custom('minecraft:cherry_planks')).toBe(false);
  });
});

describe('the event input', () => {
  it('accepts a complete competition', () => {
    expect(problems(input())).toEqual([]);
  });

  it('needs an end after the start, and not more than a year', () => {
    expect(problems({ ...input(), endsAt: '2026-09-20T10:00:00Z' })).toEqual(['endsAt']);
    expect(problems({ ...input(), endsAt: '2028-01-01T00:00:00Z' })).toEqual(['endsAt']);
  });

  it('needs something to count and a real time zone', () => {
    expect(problems({ ...input(), metric: { kind: 'mined', presets: [], blocks: [] } })).toEqual([
      'metric',
    ]);
    expect(problems({ ...input(), timezone: 'Mars/Olympus' })).toEqual(['timezone']);
    expect(
      problems({ ...input(), metric: { kind: 'mined', presets: [], blocks: ['bad id!'] } }),
    ).toContain('metric.blocks.0');
  });

  it('rewards only places of the top, each once, with known placeholders', () => {
    const at = (places: object[]) => problems({ ...input(), rewards: { places } });
    expect(at([{ place: 4, commands: ['say hi'] }])).toEqual(['rewards.places.0.place']);
    expect(
      at([
        { place: 1, commands: ['say a'] },
        { place: 1, commands: ['say b'] },
      ]),
    ).toEqual(['rewards.places.1.place']);
    expect(at([{ place: 1, commands: ['say {who}'] }])).toEqual(['rewards.places.0.commands.0']);
  });

  it('checks the placeholders of the texts', () => {
    const messages = { ...defaultMessages(), join: 'Hi {nope}', command: 'top' };
    expect(problems({ ...input(), messages }).sort()).toEqual([
      'messages.command',
      'messages.join',
    ]);
  });

  it('keeps the name on one line', () => {
    expect(problems({ ...input(), name: 'two\nlines' })).toEqual(['name']);
  });
});
