import type { SessionState } from '@outpost/shared';
import { defineWebPlugin, WEB_PLUGIN_API_VERSION } from '@outpost/web-plugin-api';
import { describe, expect, it } from 'vitest';
import { buildNavItems } from './shell.js';

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
    ]);
    expect(buildNavItems([], session(false)).map((item) => item.id)).toEqual(['core.home']);
  });
});
