import { describe, expect, it } from 'vitest';
import { configOf, toEvent, type EventRow } from './engine.js';

// An event as version 0.4.1 stored it: what came later must still read it, with defaults for what
// did not exist yet. Never change this row; add rows for the versions that follow.
const stored041: EventRow = {
  id: 'e1',
  server_id: 's1',
  name: 'Wood week',
  timezone: 'Europe/Berlin',
  state: 'active',
  starts_at: Date.parse('2026-09-19T10:00:00Z'),
  ends_at: Date.parse('2026-09-26T10:00:00Z'),
  config: JSON.stringify({
    metric: { kind: 'mined', presets: ['wood'], blocks: ['minecraft:cherry_log'] },
    scoring: { kind: 'sum' },
    participants: { top: 3, excludeOperators: true, excluded: [] },
    rewards: { places: [{ place: 1, commands: ['give {player} diamond 5'] }] },
    messages: {
      command: '!top',
      description: '&7Cut the most trees!',
      top: '&6&l{event}&r &7- {metric}\n{description}\n{top}\n&7Your place: &f{your_place} &7({your_score}) &8| &7ends in &f{ends_in}',
      entry: '&e{place}. &f{name} &7- &a{score}',
      joinNotice: true,
      join: '&6&l{event}&r &7ends in &f{ends_in}\n{description}',
      announceResults: true,
      results: '&6&l{event}&r &7is over! The winners:\n{top}',
      reward: '&6[{event}] &aYou took place {place} with {score} - your reward is here!',
    },
  }),
  baseline_at: Date.parse('2026-09-19T10:00:05Z'),
  counted_at: Date.parse('2026-09-19T12:00:00Z'),
  results: null,
  finished_at: null,
  problem: null,
  created_by: 'u1',
  created_at: Date.parse('2026-09-19T09:00:00Z'),
  updated_at: Date.parse('2026-09-19T12:00:00Z'),
} as EventRow;

// An event as version 0.4.2 stored it: with announcements and its own interval, before goals and
// the other statistics existed.
const stored042: EventRow = {
  ...stored041,
  id: 'e2',
  name: 'Ice Rush',
  config: JSON.stringify({
    ...JSON.parse(stored041.config),
    metric: { kind: 'fish_caught' },
    countEveryMinutes: 1,
    announcements: [
      { anchor: 'start', minutesBefore: 10, text: '&6{event} starts in {starts_in}' },
    ],
  }),
  announced: JSON.stringify(['start:10']),
} as EventRow;

describe('events stored by earlier versions', () => {
  it('include the ones with announcements and the fish caught', () => {
    expect(toEvent(stored042)).toMatchObject({
      name: 'Ice Rush',
      metric: { kind: 'fish_caught' },
      scoring: { kind: 'sum' },
      countEveryMinutes: 1,
      announcements: [{ anchor: 'start', minutesBefore: 10 }],
    });
    // The texts of 0.4.1 have no message for completions: they get the default one.
    expect(configOf(stored042).messages.announceCompletions).toBe(true);
    expect(configOf(stored042).messages.completion).toContain('{player}');
  });

  it('are read by this version, with defaults for what is new', () => {
    const event = toEvent(stored041);
    expect(event).toMatchObject({
      id: 'e1',
      name: 'Wood week',
      state: 'active',
      metric: { kind: 'mined', presets: ['wood'], blocks: ['minecraft:cherry_log'] },
      participants: { top: 3, excludeOperators: true, excluded: [] },
      countEveryMinutes: 5,
      announcements: [],
    });
    expect(configOf(stored041).messages.command).toBe('!top');
  });
});
