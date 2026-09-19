import { describe, expect, it } from 'vitest';
import {
  announcementCommand,
  parseMessage,
  renderTemplate,
  tellrawCommand,
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
