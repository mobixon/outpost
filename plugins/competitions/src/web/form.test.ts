import { describe, expect, it } from 'vitest';
import { eventInputSchema, type CompetitionEvent, type Metric } from '../shared.js';
import {
  applyPeriod,
  changeTimezone,
  cloneForm,
  emptyForm,
  formFromJson,
  inputOf,
  emptyMetricForm,
  metricFormOf,
  parseBlocks,
  parseCommands,
  problemsOf,
  switchMode,
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
    applyPeriod(form, 48 * 60);
    expect(form.end).toBe('2026-09-21T10:01');
    changeTimezone(form, 'Europe/Moscow');
    expect(form.start).toBe('2026-09-19T13:01');
    expect(form.end).toBe('2026-09-21T13:01');
  });

  it('says what is missing', () => {
    const form = emptyForm('UTC', NOW);
    expect(problemsOf(form)).toEqual(['name']);
    form.name = 'x';
    form.metric.presets = [];
    expect(problemsOf(form)).toEqual(['metric']);
    form.metric.blocks = 'cherry_log, Minecraft:oak_log';
    expect(problemsOf(form)).toEqual([]);
    form.end = form.start;
    expect(problemsOf(form)).toEqual(['period']);
  });

  it('offers short periods and copies an event to start again', () => {
    const form = emptyForm('UTC', NOW);
    applyPeriod(form, 10);
    expect(form.end).toBe('2026-09-19T10:11');
    const copy = cloneForm(
      {
        ...eventInputSchema.parse(toInput({ ...form, name: 'Ice Rush' })),
        id: 'e1',
        state: 'finished',
        baselineAt: null,
        finishedAt: null,
        problem: null,
        createdAt: '2026-09-19T09:00:00.000Z',
        updatedAt: '2026-09-19T09:00:00.000Z',
        rewards: { places: [] },
      } as unknown as CompetitionEvent,
      Date.parse('2026-09-21T15:00:30Z'),
    );
    expect(copy.name).toBe('Ice Rush (copy)');
    expect(copy.start).toBe('2026-09-21T15:01');
    expect(copy.end).toBe('2026-09-21T15:11');
    expect(copy.announcements).toHaveLength(3);
  });

  it('keeps the announcements and the counting interval in the request', () => {
    const form = emptyForm('UTC', NOW);
    form.name = 'x';
    form.countEveryMinutes = 1;
    form.announcements = [{ anchor: 'end', minutesBefore: 2, text: ' &cLast minutes! ' }];
    expect(toInput(form)).toMatchObject({
      countEveryMinutes: 1,
      announcements: [{ anchor: 'end', minutesBefore: 2, text: '&cLast minutes!' }],
    });
    expect(eventInputSchema.safeParse(toInput(form)).success).toBe(true);
  });

  it('counts fish without asking for blocks, and keeps the blocks when switching back', () => {
    const form = emptyForm('UTC', NOW);
    form.name = 'Fishing week';
    form.metric.presets = [];
    form.metric.kind = 'fish_caught';
    expect(problemsOf(form)).toEqual([]);
    const input = toInput(form);
    expect(input?.metric).toEqual({ kind: 'fish_caught' });
    expect(eventInputSchema.safeParse(input).success).toBe(true);
    form.metric.kind = 'mined';
    expect(problemsOf(form)).toEqual(['metric']);
  });

  it('describes goals with a metric for every target, and takes a reward for everyone', () => {
    const form = emptyForm('UTC', NOW);
    form.name = 'Lumberjack';
    switchMode(form, 'goals');
    expect(form.messages.command).toBe('!goal');
    expect(problemsOf(form)).toEqual(['targets']);
    form.targets = [
      {
        label: 'Spruce logs',
        metric: { ...emptyMetricForm(), presets: [], blocks: 'spruce_log' },
        amount: 20,
      },
      {
        label: 'Ore drops',
        metric: {
          ...emptyMetricForm(),
          kind: 'stat',
          category: 'picked_up',
          statPresets: ['ore_drops', 'hostile_mobs'],
        },
        amount: 5,
      },
    ];
    form.rewards[0] = 'give {player} diamond 1';
    form.rewards[1] = 'say ignored: a goals event has one reward';
    expect(problemsOf(form)).toEqual([]);
    const input = toInput(form);
    expect(input).toMatchObject({
      scoring: {
        kind: 'targets',
        targets: [
          {
            label: 'Spruce logs',
            metric: { kind: 'mined', blocks: ['minecraft:spruce_log'] },
            amount: 20,
          },
          // Presets of another category than the one picked are left out.
          {
            label: 'Ore drops',
            metric: { kind: 'stat', category: 'picked_up', presets: ['ore_drops'] },
            amount: 5,
          },
        ],
      },
      rewards: { places: [{ place: 1, commands: ['give {player} diamond 1'] }] },
    });
    expect(input).not.toHaveProperty('metric');
    expect(eventInputSchema.safeParse(input).success).toBe(true);

    const first = form.targets[0];
    if (first === undefined) throw new Error('No target');
    first.amount = 0;
    expect(problemsOf(form)).toEqual(['targets']);
    first.amount = 20;
    first.label = 'Bad {label}';
    expect(problemsOf(form)).toEqual(['targets']);
  });

  it('keeps the texts that were changed when the kind of event changes', () => {
    const form = emptyForm('UTC', NOW);
    switchMode(form, 'goals');
    expect(form.messages.top).toContain('{goals}');
    switchMode(form, 'ranking');
    expect(form.messages.command).toBe('!top');
    form.messages.top = 'my own text {top}';
    switchMode(form, 'goals');
    expect(form.messages.top).toBe('my own text {top}');
    expect(form.mode).toBe('goals');
  });

  it('counts another statistic, with the presets of its category', () => {
    const form = emptyForm('UTC', NOW);
    form.name = 'Hunt';
    form.metric = {
      ...emptyMetricForm(),
      kind: 'stat',
      category: 'killed',
      statPresets: ['undead'],
      ids: 'cow, *_golem',
    };
    expect(problemsOf(form)).toEqual([]);
    expect(toInput(form)?.metric).toEqual({
      kind: 'stat',
      category: 'killed',
      presets: ['undead'],
      ids: ['minecraft:cow', 'minecraft:*_golem'],
    });
    form.metric.category = 'picked_up';
    form.metric.ids = '';
    expect(problemsOf(form)).toEqual(['metric']);
    expect(metricFormOf(toInput(form)?.metric as Metric).category).toBe('picked_up');
  });

  it('changes only what a small piece of JSON says', () => {
    const form = emptyForm('UTC', NOW);
    form.name = 'Old';
    form.messages.description = 'Kept';
    const result = formFromJson(
      '{ "name": "Ice Rush", "participants": { "top": 5 }, "messages": { "command": "!ice" }, "colour": 1 }',
      form,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.form).toMatchObject({
      name: 'Ice Rush',
      top: 5,
      excludeOperators: true,
      start: form.start,
      end: form.end,
    });
    expect(result.form.messages).toMatchObject({ command: '!ice', description: 'Kept' });
    expect(result.ignored).toEqual(['colour']);
  });

  it('says what is wrong with a JSON that does not fit', () => {
    const form = emptyForm('UTC', NOW);
    form.name = 'x';
    const errors = (text: string) => {
      const result = formFromJson(text, form);
      return result.ok ? [] : result.errors;
    };
    expect(errors('{ "name": ')[0]).toMatch(/^Not valid JSON/);
    expect(errors('[1]')).toEqual(['The JSON must be an object {…}']);
    expect(errors('{ "endsAt": "2020-01-01T00:00:00Z" }')).toEqual([
      'endsAt: The end must be after the start',
    ]);
    expect(errors('{ "participants": { "top": 99 }, "countEveryMinutes": 0 }').sort()).toEqual([
      'countEveryMinutes: Too small: expected number to be >=1',
      'participants.top: Too big: expected number to be <=10',
    ]);
    expect(
      errors(
        '{ "metric": { "kind": "stat", "category": "killed", "presets": ["ore_drops"], "ids": [] } }',
      ),
    ).toEqual(['metric: Pick what is counted']);
  });

  it('copies an event as JSON and reads the same event back, for goals too', () => {
    const goals = emptyForm('Europe/Berlin', NOW);
    goals.name = 'Quest';
    switchMode(goals, 'goals');
    goals.targets = [
      {
        label: 'Spruce',
        metric: { ...emptyMetricForm(), presets: [], blocks: 'spruce_log' },
        amount: 20,
      },
    ];
    goals.rewards[0] = 'give {player} diamond 1';
    for (const form of [emptyForm('Europe/Berlin', NOW), goals]) {
      form.name = form.name === '' ? 'Wood' : form.name;
      form.rewards[0] = 'give {player} diamond 1';
      const input = toInput(form);
      expect(input).not.toBeNull();
      const parts = eventInputSchema.parse(input);
      const json = JSON.stringify(inputOf(parts as never), null, 2);
      const back = formFromJson(json, emptyForm('UTC', NOW));
      expect(back.ok).toBe(true);
      if (back.ok) expect(toInput(back.form)).toEqual(input);
    }
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
