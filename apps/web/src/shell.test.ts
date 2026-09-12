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
});
