import { describe, expect, it } from 'vitest';
import {
  normalizeReason,
  offlineUuid,
  parseBanList,
  parsePlayerList,
  parseProperties,
  parseWhitelist,
  stripFormatting,
  uuidMode,
} from './minecraft.js';

const STEVE = '8667ba71-b85a-4004-af54-457a9734eed7';
const OFFLINE = 'b50ad385-829d-3141-a216-7e7d7539ba7f';

describe('parsePlayerList', () => {
  it.each([
    [
      'There are 2 of a max of 20 players online: Steve, Alex',
      { online: 2, max: 20, names: ['Steve', 'Alex'] },
    ],
    ['There are 0 of a max of 5 players online: ', { online: 0, max: 5, names: [] }],
    ['There are 1/10 players online:\nNotch', { online: 1, max: 10, names: ['Notch'] }],
    [
      '§6There are §c1§6 out of maximum §c50§6 players online.\n§6default§r: Steve',
      { online: 1, max: 50, names: ['Steve'] },
    ],
  ])('parses %j', (reply, list) => {
    expect(parsePlayerList(reply)).toMatchObject(list);
  });

  it('reads the UUIDs of `list uuids`', () => {
    expect(
      parsePlayerList(
        `There are 2 of a max of 20 players online: Steve (${STEVE}), alex (${OFFLINE.toUpperCase()})`,
      )?.players,
    ).toEqual([
      { name: 'Steve', uuid: STEVE },
      { name: 'alex', uuid: OFFLINE },
    ]);
  });

  it('returns null for unknown replies and strips formatting codes', () => {
    expect(parsePlayerList('Unknown command')).toBeNull();
    expect(stripFormatting('§aGreen §lbold§r')).toBe('Green bold');
  });
});

describe('parseWhitelist', () => {
  it.each([
    ['There are no whitelisted players', []],
    [
      'There are 2 whitelisted player(s): outpostnosuchplayer1, Notch',
      ['outpostnosuchplayer1', 'Notch'],
    ],
    ['Unknown or incomplete command', null],
  ])('parses %j', (reply, names) => {
    expect(parseWhitelist(reply)).toEqual(names);
  });
});

describe('parseBanList', () => {
  // Replies recorded from Minecraft 26.2 over RCON.
  it('splits the entries that Minecraft joins without separators', () => {
    expect(
      parseBanList(
        'There are 2 ban(s):outpostnosuchplayer1 was banned by Rcon: Banned by an operator.Notch was banned by Rcon: griefing the spawn',
        'players',
      ),
    ).toEqual([
      { target: 'outpostnosuchplayer1', source: 'Rcon', reason: 'Banned by an operator.' },
      { target: 'Notch', source: 'Rcon', reason: 'griefing the spawn' },
    ]);
    expect(parseBanList('There are 1 ban(s):10.1.2.3 was banned by Rcon: spam', 'ips')).toEqual([
      { target: '10.1.2.3', source: 'Rcon', reason: 'spam' },
    ]);
    expect(parseBanList('There are no bans', 'players')).toEqual([]);
    expect(parseBanList('Unknown or incomplete command', 'players')).toBeNull();
  });

  it('uses known names where a reason ends with letters', () => {
    const reply =
      'There are 2 ban(s):Alex was banned by admin: griefing the spawnNotch was banned by Rcon: x';
    expect(parseBanList(reply, 'players')?.map((entry) => entry.target)).toEqual([
      'Alex',
      'spawnNotch',
    ]);
    expect(parseBanList(reply, 'players', ['Notch'])).toEqual([
      { target: 'Alex', source: 'admin', reason: 'griefing the spawn' },
      { target: 'Notch', source: 'Rcon', reason: 'x' },
    ]);
    expect(
      parseBanList(
        'There are 2 ban(s):10.0.0.1 was banned by Rcon: spam.192.168.1.20 was banned by admin: bots',
        'ips',
      )?.map((entry) => entry.target),
    ).toEqual(['10.0.0.1', '192.168.1.20']);
  });
});

describe('normalizeReason', () => {
  it.each([
    [undefined, ''],
    ['  ', ''],
    ['griefing the spawn', 'griefing the spawn.'],
    ['spam!', 'spam!'],
    ['line one\nline two', 'line one line two.'],
    ['читы', 'читы.'],
  ])('%j -> %j', (reason, normalized) => {
    expect(normalizeReason(reason)).toBe(normalized);
  });
});

describe('uuidMode', () => {
  it('tells offline from online UUIDs', () => {
    expect(uuidMode(STEVE)).toBe('online');
    expect(uuidMode(OFFLINE)).toBe('offline');
    expect(uuidMode('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('offlineUuid', () => {
  it('is the name-based UUID Minecraft gives offline players, by the exact name', () => {
    expect(offlineUuid('Notch')).toBe(OFFLINE);
    expect(offlineUuid('Steve')).toBe('5627dd98-e6be-3c21-b8a8-e92344183641');
    expect(offlineUuid('steve')).toBe('53909932-f794-33c0-9329-948045a4c1ce');
    expect(uuidMode(offlineUuid('Alex'))).toBe('offline');
  });
});

describe('parseProperties', () => {
  it('reads server.properties as Java writes it', () => {
    const properties = parseProperties(
      [
        '#Minecraft server properties',
        '#Sun Sep 14 12:00:00 UTC 2026',
        'online-mode=false',
        'motd=A Minecraft Server\\: \\u00A7aHi',
        'white-list = true\r',
        'level-seed=',
        'long=one \\',
        '    two',
        '! a comment',
        'key:value',
      ].join('\n'),
    );
    expect(Object.fromEntries(properties)).toEqual({
      'online-mode': 'false',
      motd: 'A Minecraft Server: §aHi',
      'white-list': 'true',
      'level-seed': '',
      long: 'one two',
      key: 'value',
    });
  });
});
