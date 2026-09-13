import { offlineUuid } from '@outpost/shared';
import { describe, expect, it } from 'vitest';
import { hasWrongUuid, PerServerQueue, properName } from './whitelist.js';

const MOJANG = '8667ba71-b85a-4004-af54-457a9734eed7';
const FLOODGATE = '00000000-0000-0000-0009-01f2b3c4d5e6';

describe('properName', () => {
  it('takes the spelling of a known player', () => {
    expect(properName('steve', ['Alex', 'Steve'])).toBe('Steve');
    expect(properName('steve', ['Steve', 'steve'])).toBe('steve');
    expect(properName('Newbie', ['Steve'])).toBe('Newbie');
  });
});

describe('hasWrongUuid', () => {
  it('flags Mojang UUIDs and other spellings on offline-mode servers', () => {
    expect(hasWrongUuid({ name: 'Steve', uuid: offlineUuid('Steve') }, 'offline', [])).toBe(false);
    expect(hasWrongUuid({ name: 'Steve', uuid: MOJANG }, 'offline', [])).toBe(true);
    expect(hasWrongUuid({ name: 'steve', uuid: offlineUuid('steve') }, 'offline', ['Steve'])).toBe(
      true,
    );
    expect(hasWrongUuid({ name: '.Bedrock', uuid: FLOODGATE }, 'offline', [])).toBe(false);
  });

  it('flags name-based UUIDs on online-mode servers and nothing in an unknown mode', () => {
    expect(hasWrongUuid({ name: 'Steve', uuid: offlineUuid('Steve') }, 'online', [])).toBe(true);
    expect(hasWrongUuid({ name: 'Steve', uuid: MOJANG }, 'online', [])).toBe(false);
    expect(hasWrongUuid({ name: 'Steve', uuid: MOJANG }, null, [])).toBe(false);
  });
});

describe('PerServerQueue', () => {
  it('runs the tasks of a server one after another, also after a failure', async () => {
    const queue = new PerServerQueue();
    const order: string[] = [];
    let release = () => {};
    const first = queue.run('a', async () => {
      await new Promise<void>((resolve) => (release = resolve));
      order.push('a1');
      throw new Error('failed');
    });
    const second = queue.run('a', () => Promise.resolve(order.push('a2')));
    const other = queue.run('b', () => Promise.resolve(order.push('b1')));
    await other;
    release();
    await expect(first).rejects.toThrow('failed');
    await second;
    expect(order).toEqual(['b1', 'a1', 'a2']);
  });
});
