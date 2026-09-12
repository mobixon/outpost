import { describe, expect, it } from 'vitest';
import { chatCommand } from './shared.js';

describe('chatCommand', () => {
  it('builds a tellraw command with the message JSON-encoded', () => {
    const command = chatCommand('ann', 'hi "all"\n@a {"text":"x"}');
    expect(command.startsWith('tellraw @a [')).toBe(true);
    const components = JSON.parse(command.slice('tellraw @a '.length)) as { text: string }[];
    expect(components.map((component) => component.text)).toEqual([
      '[Web] ',
      'ann: ',
      'hi "all" @a {"text":"x"}',
    ]);
  });
});
