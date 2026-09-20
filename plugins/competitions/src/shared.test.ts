import { describe, expect, it } from 'vitest';
import {
  blockMatcher,
  defaultAnnouncements,
  defaultGoalMessages,
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

  it('counts blocks or fish, and fish need nothing more', () => {
    expect(problems({ ...input(), metric: { kind: 'fish_caught' } })).toEqual([]);
    expect(problems({ ...input(), metric: { kind: 'fish_caught', presets: [] } })).toEqual([]);
    expect(problems({ ...input(), metric: { kind: 'sheep' } })).toEqual(['metric.kind']);
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

  it('takes goals with a metric of their own for every target', () => {
    const withoutMetric: Partial<ReturnType<typeof input>> = input();
    delete withoutMetric.metric;
    const goals = {
      ...withoutMetric,
      scoring: {
        kind: 'targets' as const,
        targets: [
          {
            label: 'Spruce logs',
            metric: { kind: 'mined' as const, presets: [], blocks: ['spruce_log'] },
            amount: 20,
          },
          {
            label: 'Ore drops',
            metric: {
              kind: 'stat' as const,
              category: 'picked_up' as const,
              presets: ['ore_drops' as const],
              ids: [],
            },
            amount: 5,
          },
        ],
      },
      participants: { top: 3, excludeOperators: true, excluded: [] },
      messages: defaultGoalMessages(),
    };
    expect(problems(goals)).toEqual([]);
    // Targets need to say what they count, and a reward is for everyone: place 1 only.
    const empty = {
      ...goals,
      scoring: {
        kind: 'targets' as const,
        targets: [
          { label: 'x', metric: { kind: 'mined' as const, presets: [], blocks: [] }, amount: 1 },
        ],
      },
    };
    expect(problems(empty)).toEqual(['scoring.targets.0.metric']);
    expect(
      problems({ ...goals, rewards: { places: [{ place: 2, commands: ['say hi'] }] } }),
    ).toEqual(['rewards.places.0.place']);
    expect(
      problems({ ...goals, rewards: { places: [{ place: 1, commands: ['say {player}'] }] } }),
    ).toEqual([]);
    const labelled = (label: string) => ({
      ...goals,
      scoring: {
        kind: 'targets' as const,
        targets: [{ label, metric: { kind: 'fish_caught' as const }, amount: 1 }],
      },
    });
    expect(problems(labelled('Bad {label} &c'))).toEqual(['scoring.targets.0.label']);
    expect(problems({ ...goals, scoring: { kind: 'targets', targets: [] } })).toEqual([
      'scoring.targets',
    ]);
  });

  it('needs a metric for a ranking, and takes the other statistics', () => {
    const withoutMetric: Partial<ReturnType<typeof input>> = input();
    delete withoutMetric.metric;
    expect(problems(withoutMetric)).toEqual(['metric']);
    const stat = (presets: string[]) => ({
      ...input(),
      metric: { kind: 'stat', category: 'picked_up', presets, ids: [] },
    });
    expect(problems(stat(['ore_drops']))).toEqual([]);
    expect(problems(stat(['hostile_mobs']))).toEqual(['metric']);
    expect(problems(stat([]))).toEqual(['metric']);
  });

  it('accepts the default announcements, and only one message per moment', () => {
    expect(problems({ ...input(), announcements: defaultAnnouncements() })).toEqual([]);
    const twice = [
      { anchor: 'end' as const, minutesBefore: 5, text: 'a' },
      { anchor: 'end' as const, minutesBefore: 5, text: 'b' },
    ];
    expect(problems({ ...input(), announcements: twice })).toEqual([
      'announcements.1.minutesBefore',
    ]);
    expect(
      problems({
        ...input(),
        announcements: [{ anchor: 'start', minutesBefore: 1, text: 'hi {nope}' }],
      }),
    ).toEqual(['announcements.0.text']);
    expect(
      problems({ ...input(), announcements: [{ anchor: 'start', minutesBefore: -1, text: 'x' }] }),
    ).toEqual(['announcements.0.minutesBefore']);
  });

  it('counts every 1 to 60 minutes, 5 by default', () => {
    expect(eventInputSchema.parse(input()).countEveryMinutes).toBe(5);
    expect(problems({ ...input(), countEveryMinutes: 0 })).toEqual(['countEveryMinutes']);
    expect(problems({ ...input(), countEveryMinutes: 61 })).toEqual(['countEveryMinutes']);
    expect(problems({ ...input(), countEveryMinutes: 1 })).toEqual([]);
  });

  it('keeps the name on one line', () => {
    expect(problems({ ...input(), name: 'two\nlines' })).toEqual(['name']);
  });
});
