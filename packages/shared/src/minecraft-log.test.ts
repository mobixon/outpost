import { describe, expect, it } from 'vitest';
import { parseLogLine } from './minecraft-log.js';

describe('parseLogLine', () => {
  it('reads chat messages, joins and leaves of vanilla', () => {
    expect(parseLogLine('[12:00:01] [Server thread/INFO]: <Steve> !top')).toEqual({
      type: 'chat',
      player: 'Steve',
      message: '!top',
    });
    expect(parseLogLine('[12:00:01] [Server thread/INFO]: Steve joined the game')).toEqual({
      type: 'joined',
      player: 'Steve',
    });
    expect(parseLogLine('[12:00:01] [Server thread/INFO]: Steve left the game\r')).toEqual({
      type: 'left',
      player: 'Steve',
    });
  });

  it('reads the formats of Fabric, mods and Paper', () => {
    for (const header of [
      '[12:00:01] [Server thread/INFO] (Minecraft)',
      '[12:00:01] [Server thread/INFO] [minecraft/MinecraftServer]:',
      '[12:00:01 INFO]:',
    ]) {
      expect(parseLogLine(`${header} <Alex> hello there`)).toEqual({
        type: 'chat',
        player: 'Alex',
        message: 'hello there',
      });
    }
  });

  it('reads messages of servers without chat signing', () => {
    expect(parseLogLine('[12:00:01] [Server thread/INFO]: [Not Secure] <Steve> !top')).toEqual({
      type: 'chat',
      player: 'Steve',
      message: '!top',
    });
  });

  it('does not take what a player types for a join', () => {
    expect(
      parseLogLine('[12:00:01] [Server thread/INFO]: <Mallory> Steve joined the game'),
    ).toEqual({ type: 'chat', player: 'Mallory', message: 'Steve joined the game' });
    expect(parseLogLine('[12:00:01] [Server thread/INFO]: [Server] Steve joined the game')).toBe(
      null,
    );
  });

  it('ignores everything else', () => {
    expect(parseLogLine('[12:00:01] [Server thread/WARN]: <Steve> hi')).toBe(null);
    expect(parseLogLine('[12:00:01] [Server thread/INFO]: Done (3.2s)!')).toBe(null);
    expect(parseLogLine('at net.minecraft.Foo(Foo.java:1)')).toBe(null);
  });
});
