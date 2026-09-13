import type { SessionState } from '@outpost/shared';
import { defineWebPlugin, WEB_PLUGIN_API_VERSION } from '@outpost/web-plugin-api';
import { describe, expect, it } from 'vitest';
import { buildNavItems, buildServerTabs } from './shell.js';

const TestIcon = { name: 'TestIcon', render: () => null };

const plugin = (id: string, items: { key: string; order?: number }[]) =>
  defineWebPlugin({
    id,
    apiVersion: WEB_PLUGIN_API_VERSION,
    navItems: items.map((item) => ({
      ...item,
      label: item.key,
      icon: TestIcon,
      to: `/${item.key}`,
    })),
  });

describe('buildNavItems', () => {
  it('starts with home and sorts plugin entries by order, keeping plugin order for ties', () => {
    const items = buildNavItems([
      plugin('test.a', [{ key: 'late', order: 900 }, { key: 'plain' }]),
      plugin('test.b', [{ key: 'early', order: 10 }, { key: 'other' }]),
    ]);
    expect(items.map((item) => item.id)).toEqual([
      'core.home',
      'test.b.early',
      'test.a.plain',
      'test.b.other',
      'test.a.late',
    ]);
  });

  it('adds the administration pages for superadmins', () => {
    const session = (isSuperadmin: boolean): SessionState => ({
      setupRequired: false,
      status: 'active',
      user: {
        id: 'u1',
        username: 'ann',
        isSuperadmin,
        hasPassword: true,
        twoFactorEnabled: true,
        backupCodesLeft: 10,
        theme: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      twoFactorEnrollmentRequired: false,
      sudoUntil: null,
      providers: [],
    });
    expect(buildNavItems([], session(true)).map((item) => item.id)).toEqual([
      'core.home',
      'core.users',
      'core.invitations',
      'core.audit',
    ]);
    expect(buildNavItems([], session(false)).map((item) => item.id)).toEqual(['core.home']);
  });
});

describe('buildServerTabs', () => {
  it('collects the server tabs of the plugins', () => {
    const plugin = defineWebPlugin({
      id: 'test.console',
      apiVersion: WEB_PLUGIN_API_VERSION,
      serverTabs: [
        {
          key: 'console',
          label: 'console.tab',
          icon: TestIcon,
          component: TestIcon,
          permission: 'console.read',
          capability: 'logs.stream',
          order: 100,
        },
      ],
    });
    expect(buildServerTabs([plugin])).toEqual([
      {
        id: 'test.console.console',
        key: 'console',
        label: 'console.tab',
        icon: TestIcon,
        permission: 'console.read',
        capability: 'logs.stream',
        games: null,
        order: 100,
      },
    ]);
  });

  it('gives the tabs the games of their plugin, as the server reports them', () => {
    const plugin = defineWebPlugin({
      id: 'test.players',
      apiVersion: WEB_PLUGIN_API_VERSION,
      serverTabs: [
        { key: 'players', label: 'x', icon: TestIcon, component: TestIcon, permission: 'x.y' },
      ],
    });
    const games = new Map([['test.players', ['minecraft-java']]]);
    expect(buildServerTabs([plugin], games)[0]?.games).toEqual(['minecraft-java']);
  });

  it('rejects reserved tab keys', () => {
    expect(() =>
      defineWebPlugin({
        id: 'test.evil',
        apiVersion: WEB_PLUGIN_API_VERSION,
        serverTabs: [
          { key: 'members', label: 'x', icon: TestIcon, component: TestIcon, permission: 'x.y' },
        ],
      }),
    ).toThrow(/reserved server tab key/);
  });
});
