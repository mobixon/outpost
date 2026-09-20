import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatInstant,
  eventLabel,
  goalView,
  metricLabel,
  renderCompletion,
  renderResults,
  renderAnnouncement,
  renderJoin,
  renderReward,
  renderTop,
  toLines,
  type RenderableEvent,
} from './render.js';
import { defaultGoalMessages, defaultMessages, type Standing } from './shared.js';

const NOW = Date.parse('2026-09-19T10:00:00Z');
const event: RenderableEvent = {
  name: 'Wood week',
  startsAt: '2026-09-19T12:00:00Z',
  endsAt: '2026-09-22T15:00:00Z',
  timezone: 'Europe/Moscow',
  metric: { kind: 'mined', presets: ['wood'], blocks: ['minecraft:cherry_log'] },
  scoring: { kind: 'sum' },
  participants: { top: 2, excludeOperators: true, excluded: [] },
  messages: { ...defaultMessages(), description: '&7Cut the most trees!' },
};
const standings: Standing[] = [
  { place: 1, uuid: 'a', name: 'Steve', score: 1240 },
  { place: 2, uuid: 'b', name: 'Alex', score: 980 },
  { place: 3, uuid: 'c', name: 'Notch', score: 655 },
];

describe('rendering', () => {
  it('says how long is left', () => {
    expect(formatDuration(30_000)).toBe('less than a minute');
    expect(formatDuration(5 * 60_000)).toBe('5m');
    expect(formatDuration(3 * 3_600_000 + 12 * 60_000)).toBe('3h 12m');
    expect(formatDuration(2 * 86_400_000)).toBe('2d');
    expect(formatDuration(2 * 86_400_000 + 4 * 3_600_000)).toBe('2d 4h');
    expect(formatDuration(-5)).toBe('less than a minute');
  });

  it('shows moments in the time zone of the competition', () => {
    expect(formatInstant(Date.parse('2026-09-28T15:00:00Z'), 'Europe/Moscow')).toContain('18:00');
    expect(eventLabel(event)).toBe('Mined: wood, 1 other');
    expect(metricLabel({ kind: 'fish_caught' })).toBe('Fish caught');
  });

  it('answers the chat command with the top, the place of the player and the time left', () => {
    const lines = renderTop(event, standings, NOW, { name: 'alex' });
    expect(lines).toEqual([
      '&6&lWood week&r &7- Mined: wood, 1 other',
      '&7Cut the most trees!',
      '&e1. &fSteve &7- &a1,240',
      '&e2. &fAlex &7- &a980',
      '&7Your place: &f#2 &7(980) &8| &7ends in &f3d 5h',
    ]);
  });

  it('shows only the places of the top, and a dash to players without a score', () => {
    const lines = renderJoin(event, standings, NOW, { name: 'Nobody' });
    expect(lines.join('\n')).toContain('Your place: &f- &7(0)');
    expect(renderTop(event, standings, NOW).join('\n')).not.toContain('Notch');
  });

  it('says so when nobody has scored, and leaves out lines that came out empty', () => {
    const lines = renderTop(
      { ...event, messages: { ...event.messages, description: '' } },
      [],
      NOW,
    );
    expect(lines).toContain('&7Nobody has scored yet.');
    expect(lines).toHaveLength(3);
    expect(toLines('a\n\n  \nb\n')).toEqual(['a', 'b']);
  });

  it('fills in an announcement with the time to the start and the command', () => {
    const lines = renderAnnouncement(
      event,
      '&6{event} starts in {starts_in} ({starts_at}), ends in {ends_in}. {command} {description}',
      standings,
      NOW,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('starts in 2h (');
    expect(lines[0]).toContain('ends in 3d 5h. !top &7Cut the most trees!');
  });

  it('describes what is counted, for every kind of metric and for goals', () => {
    expect(
      metricLabel({
        kind: 'stat',
        category: 'picked_up',
        presets: ['ore_drops'],
        ids: ['*_ingot'],
      }),
    ).toBe('Picked up: ore drops, 1 other');
    expect(
      metricLabel({ kind: 'stat', category: 'killed', presets: ['hostile_mobs'], ids: [] }),
    ).toBe('Killed: hostile mobs');
    expect(
      eventLabel({
        scoring: {
          kind: 'targets',
          targets: [
            { label: 'Spruce', metric: { kind: 'fish_caught' }, amount: 1 },
            { label: 'Fish', metric: { kind: 'fish_caught' }, amount: 1 },
          ],
        },
      }),
    ).toBe('Goals: Spruce, Fish');
  });

  it('shows the progress of a player in a goals event, and who reached the goals', () => {
    const targets = [
      { label: 'Spruce', metric: { kind: 'fish_caught' as const }, amount: 20 },
      { label: 'Birch', metric: { kind: 'fish_caught' as const }, amount: 10 },
    ];
    const withoutMetric: RenderableEvent = { ...event };
    delete withoutMetric.metric;
    const goalsEvent: RenderableEvent = {
      ...withoutMetric,
      scoring: { kind: 'targets', targets },
      messages: defaultGoalMessages(),
    };
    const view = goalView(
      targets,
      {
        targets: [
          { label: 'Spruce', value: 20, amount: 20 },
          { label: 'Birch', value: 4, amount: 10 },
        ],
      },
      2,
    );
    expect(view.lines).toEqual(['&a✓ &fSpruce &a20&7/20', '&7• &fBirch &e4&7/10']);
    const lines = renderTop(
      goalsEvent,
      [{ place: 1, uuid: 'a', name: 'Steve', score: 2 }],
      NOW,
      { name: 'Alex' },
      view,
    );
    expect(lines).toEqual(
      [
        '&6&lWood week&r &7- Goals: Spruce, Birch',
        '&7Cut the most trees!',
        '&a✓ &fSpruce &a20&7/20',
        '&7• &fBirch &e4&7/10',
        '&7Reached by &f2 &7players. Ends in &f3d 5h',
      ].filter(
        (line) => line !== '&7Cut the most trees!' || goalsEvent.messages.description !== '',
      ),
    );
    expect(
      renderResults(goalsEvent, [{ place: 1, uuid: 'a', name: 'Steve', score: 2 }], NOW, view),
    ).toEqual(['&6&lWood week&r &7is over! Reached all the goals: &f2', '&e1. &fSteve']);
    expect(renderResults(goalsEvent, [], NOW, goalView(targets, undefined, 0))).toContain(
      '&7Nobody has reached them yet.',
    );
    expect(renderCompletion(goalsEvent, 'Steve', 3, 3)).toEqual([
      '&6[Wood week] &fSteve &ahas reached all the goals!',
    ]);
  });

  it('tells a winner about the reward', () => {
    expect(renderReward(event, { name: 'Steve', place: 1, score: 1240 })).toEqual([
      '&6[Wood week] &aYou took place 1 with 1,240 - your reward is here!',
    ]);
  });
});
