import { describe, expect, it } from 'vitest';
import { utf8 } from './md5.js';
import {
  announcementCommand,
  parseMessage,
  renderTemplate,
  tellrawCommand,
  tellrawLines,
  templatePlaceholders,
} from './messages.js';

describe('messages', () => {
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

  it('put several lines into one command, and split them only when they do not fit', () => {
    const [one, ...rest] = tellrawLines('Steve', ['&6a', 'b', '&cc'], 1446);
    expect(rest).toEqual([]);
    expect(JSON.parse((one ?? '').slice('tellraw Steve '.length))).toEqual([
      '',
      { text: 'a', color: 'gold' },
      { text: '\n' },
      { text: 'b' },
      { text: '\n' },
      { text: 'c', color: 'red' },
    ]);
    const long = 'x'.repeat(300);
    const split = tellrawLines('@a', [long, long, long, long, long, 'end'], 1000);
    expect(split.length).toBeGreaterThan(1);
    for (const command of split) expect(utf8(command).length).toBeLessThanOrEqual(1000);
    expect(split.join('')).toContain('end');
    expect(() => tellrawLines('@a', ['x'.repeat(2000)], 1446)).toThrow(RangeError);
    expect(tellrawLines('@a', [], 1446)).toEqual([]);
  });

  it('can go to one player', () => {
    expect(tellrawCommand('Steve', 'hi')).toBe('tellraw Steve ["",{"text":"hi"}]');
  });
});

describe('templates', () => {
  it('list their placeholders once', () => {
    expect(templatePlaceholders('{event}: {place}. {name} {place} {Bad} {x-y}')).toEqual([
      'event',
      'place',
      'name',
    ]);
  });

  it('fill the placeholders that have a value and leave the others', () => {
    expect(
      renderTemplate('{place}. {name} - {score} {other}', {
        place: '1',
        name: 'Steve',
        score: '5',
      }),
    ).toBe('1. Steve - 5 {other}');
  });
});
