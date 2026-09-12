import { describe, expect, it } from 'vitest';
import { parseFormatting } from './formatting.js';

describe('parseFormatting', () => {
  it('keeps plain text', () => {
    expect(parseFormatting('There are 0 players')).toEqual([{ text: 'There are 0 players' }]);
  });

  it('applies colors and formats, and resets them', () => {
    expect(parseFormatting('§6Gold §lbold§r plain §cred')).toEqual([
      { text: 'Gold ', color: '#ffaa00' },
      { text: 'bold', color: '#ffaa00', bold: true },
      { text: ' plain ' },
      { text: 'red', color: '#ff5555' },
    ]);
  });

  it('ends formats at a color code and drops unknown codes', () => {
    // A lone § at the end is kept as text.
    expect(parseFormatting('§l§obold§aGreen§kx§')).toEqual([
      { text: 'bold', bold: true, italic: true },
      { text: 'Green', color: '#55ff55' },
      { text: 'x§', color: '#55ff55' },
    ]);
  });
});
