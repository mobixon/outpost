import { describe, expect, it } from 'vitest';
import { commandFailure, rewardCommand } from './rewards.js';

describe('rewards', () => {
  it('fill the placeholders of the command for the winner', () => {
    expect(
      rewardCommand(
        '/give {player} diamond {score} # {place} {uuid} {event} {unknown}',
        { name: 'Steve', uuid: 'abc' },
        { eventName: 'Wood week', place: 1, score: 15 },
      ),
    ).toBe('give Steve diamond 15 # 1 abc Wood week {unknown}');
  });

  it('tell a failed command from the reply of the server', () => {
    expect(commandFailure('')).toBeNull();
    expect(commandFailure('Gave 5 [Diamond] to Steve')).toBeNull();
    expect(commandFailure('Unknown or incomplete command, see below for error<--[HERE]')).toEqual({
      retry: false,
      text: expect.stringContaining('<--[HERE]'),
    });
    expect(commandFailure('No player was found')).toMatchObject({ retry: true });
    expect(commandFailure('§cNo entity was found')).toMatchObject({ retry: true });
  });
});
