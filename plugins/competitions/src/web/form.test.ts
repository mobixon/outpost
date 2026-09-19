import { describe, expect, it } from 'vitest';
import { eventInputSchema } from '../shared.js';
import {
  applyPeriod,
  changeTimezone,
  emptyForm,
  parseBlocks,
  parseCommands,
  problemsOf,
  toInput,
} from './form.js';

const NOW = Date.parse('2026-09-19T10:00:30Z');

describe('the competition form', () => {
  it('starts at the next full minute and lasts a week', () => {
    const form = emptyForm('UTC', NOW);
    expect(form.start).toBe('2026-09-19T10:01');
    expect(form.end).toBe('2026-09-26T10:01');
  });

  it('turns into a request the API accepts', () => {
    const form = emptyForm('Europe/Berlin', NOW);
    form.name = ' Wood week ';
    form.rewards[0] = '/give {player} diamond 5\n\n say {player} won';
    form.rewards[4] = 'say ignored: beyond the top';
    const input = toInput(form);
    expect(input).toMatchObject({
      name: 'Wood week',
      startsAt: '2026-09-19T10:01:00.000Z',
      endsAt: '2026-09-26T10:01:00.000Z',
      rewards: {
        places: [{ place: 1, commands: ['give {player} diamond 5', 'say {player} won'] }],
      },
    });
    expect(eventInputSchema.safeParse(input).success).toBe(true);
  });

  it('applies periods and keeps the moments when the time zone changes', () => {
    const form = emptyForm('UTC', NOW);
    applyPeriod(form, 48);
    expect(form.end).toBe('2026-09-21T10:01');
    changeTimezone(form, 'Europe/Moscow');
    expect(form.start).toBe('2026-09-19T13:01');
    expect(form.end).toBe('2026-09-21T13:01');
  });

  it('says what is missing', () => {
    const form = emptyForm('UTC', NOW);
    expect(problemsOf(form)).toEqual(['name']);
    form.name = 'x';
    form.presets = [];
    expect(problemsOf(form)).toEqual(['metric']);
    form.blocks = 'cherry_log, Minecraft:oak_log';
    expect(problemsOf(form)).toEqual([]);
    form.end = form.start;
    expect(problemsOf(form)).toEqual(['period']);
  });

  it('counts fish without asking for blocks, and keeps the blocks when switching back', () => {
    const form = emptyForm('UTC', NOW);
    form.name = 'Fishing week';
    form.presets = [];
    form.metric = 'fish_caught';
    expect(problemsOf(form)).toEqual([]);
    const input = toInput(form);
    expect(input?.metric).toEqual({ kind: 'fish_caught' });
    expect(eventInputSchema.safeParse(input).success).toBe(true);
    form.metric = 'mined';
    expect(problemsOf(form)).toEqual(['metric']);
  });

  it('reads blocks and commands from text', () => {
    expect(parseBlocks('cherry_log, minecraft:OAK_LOG\n*_ore;cherry_log')).toEqual([
      'minecraft:cherry_log',
      'minecraft:oak_log',
      'minecraft:*_ore',
    ]);
    expect(parseCommands(' /say hi \n\n//tp a b')).toEqual(['say hi', 'tp a b']);
  });
});
