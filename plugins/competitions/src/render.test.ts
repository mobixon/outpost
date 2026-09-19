import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatInstant,
  metricLabel,
  renderAnnouncement,
  renderJoin,
  renderReward,
  renderTop,
  toLines,
  type RenderableEvent,
} from './render.js';
import { defaultMessages, type Standing } from './shared.js';

const NOW = Date.parse('2026-09-19T10:00:00Z');
const event: RenderableEvent = {
  name: 'Wood week',
  startsAt: '2026-09-19T12:00:00Z',
  endsAt: '2026-09-22T15:00:00Z',
  timezone: 'Europe/Moscow',
  metric: { kind: 'mined', presets: ['wood'], blocks: ['minecraft:cherry_log'] },
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
    expect(metricLabel(event.metric)).toBe('Mined: wood, 1 other');
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

  it('tells a winner about the reward', () => {
    expect(renderReward(event, { name: 'Steve', place: 1, score: 1240 })).toEqual([
      '&6[Wood week] &aYou took place 1 with 1,240 - your reward is here!',
    ]);
  });
});
