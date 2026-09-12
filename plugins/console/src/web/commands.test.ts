import { describe, expect, it } from 'vitest';
import { complete } from './commands.js';

describe('complete', () => {
  it('completes a single match with a space', () => {
    expect(complete('whi')).toEqual({ value: 'whitelist ', matches: ['whitelist'] });
    expect(complete('/lis')).toEqual({ value: 'list ', matches: ['list'] });
  });

  it('extends to the common beginning of several matches', () => {
    expect(complete('ba')).toEqual({ value: 'ban', matches: ['ban', 'ban-ip', 'banlist'] });
    expect(complete('save').matches).toEqual(['save-all', 'save-off', 'save-on']);
    expect(complete('save').value).toBe('save-');
  });

  it('leaves arguments and unknown names alone', () => {
    expect(complete('kick Ste')).toEqual({ value: 'kick Ste', matches: [] });
    expect(complete('nope')).toEqual({ value: 'nope', matches: [] });
  });
});
