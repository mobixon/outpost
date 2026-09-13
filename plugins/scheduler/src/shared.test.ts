import { describe, expect, it } from 'vitest';
import {
  announcementCommand,
  isValidCron,
  isValidTimezone,
  nextRuns,
  normalizeLines,
  parseMessage,
  taskInputSchema,
} from './shared.js';

const iso = (dates: Date[]) => dates.map((date) => date.toISOString());

describe('schedules', () => {
  it('fire at the time of day of the task time zone, also across daylight saving time', () => {
    const from = new Date('2026-03-28T12:00:00Z');
    expect(iso(nextRuns('0 5 * * *', 'Europe/Moscow', 2, from))).toEqual([
      '2026-03-29T02:00:00.000Z',
      '2026-03-30T02:00:00.000Z',
    ]);
    // Berlin moves to summer time (UTC+2) in the night to 29 March 2026.
    expect(iso(nextRuns('0 5 * * *', 'Europe/Berlin', 2, from))).toEqual([
      '2026-03-29T03:00:00.000Z',
      '2026-03-30T03:00:00.000Z',
    ]);
    expect(iso(nextRuns('*/30 * * * *', 'UTC', 3, from))).toEqual([
      '2026-03-28T12:30:00.000Z',
      '2026-03-28T13:00:00.000Z',
      '2026-03-28T13:30:00.000Z',
    ]);
  });

  it('accept five-field expressions only', () => {
    expect(isValidCron('*/15 * * * *')).toBe(true);
    expect(isValidCron('0 4 * * 1-5')).toBe(true);
    expect(isValidCron('* * * * * *')).toBe(false);
    expect(isValidCron('61 * * * *')).toBe(false);
    expect(isValidCron('every day')).toBe(false);
    expect(isValidCron('')).toBe(false);
  });

  it('know the time zones', () => {
    expect(isValidTimezone('Europe/Moscow')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
  });
});

describe('task lines', () => {
  const task = {
    name: 'Task',
    cron: '0 * * * *',
    timezone: 'UTC',
    enabled: true,
    onlyWithPlayers: false,
  };

  it('drop empty lines and the slash of commands', () => {
    expect(normalizeLines('command', [' /say hi ', '', '//save-all', '/'])).toEqual([
      'say hi',
      'save-all',
    ]);
    expect(normalizeLines('announcement', [' /help is here ', '  '])).toEqual(['/help is here']);
  });

  it('are checked for their number and length', () => {
    const valid = (type: 'command' | 'announcement', lines: string[]) =>
      taskInputSchema.safeParse({ ...task, type, lines }).success;
    expect(valid('command', ['save-all'])).toBe(true);
    expect(valid('command', ['', ' '])).toBe(false);
    expect(
      valid(
        'command',
        Array.from({ length: 21 }, () => 'say hi'),
      ),
    ).toBe(false);
    expect(valid('command', [`say ${'x'.repeat(1442)}`])).toBe(true);
    expect(valid('command', [`say ${'x'.repeat(1443)}`])).toBe(false);
    expect(valid('announcement', ['x'.repeat(256)])).toBe(true);
    expect(valid('announcement', ['x'.repeat(257)])).toBe(false);
    // Short enough, but every code adds a component to the command.
    expect(valid('announcement', ['&l'.repeat(40) + '&ax&b'.repeat(40)])).toBe(false);
  });
});

describe('announcements', () => {
  it('turn & codes into formatting', () => {
    expect(parseMessage('&6Gold &lbold&r plain & more &zx')).toEqual([
      { text: 'Gold ', color: { name: 'gold', hex: '#ffaa00' } },
      { text: 'bold', color: { name: 'gold', hex: '#ffaa00' }, bold: true },
      { text: ' plain & more &zx' },
    ]);
  });

  it('are sent with tellraw, so nothing in them changes the command', () => {
    const command = announcementCommand('&cRed "quoted" ]} @a\nnext');
    expect(command.startsWith('tellraw @a [')).toBe(true);
    expect(JSON.parse(command.slice('tellraw @a '.length))).toEqual([
      '',
      { text: 'Red "quoted" ]} @a next', color: 'red' },
    ]);
  });
});
