import { definePlugin, PLUGIN_API_VERSION, type PluginDefinition } from '@outpost/plugin-api';
import { describe, expect, it } from 'vitest';
import { PluginLoadError, resolvePlugins } from './host.js';

const plugin = (id: string, dependsOn?: string[]): PluginDefinition =>
  definePlugin({
    id,
    version: '1.0.0',
    apiVersion: PLUGIN_API_VERSION,
    ...(dependsOn && { dependsOn }),
  });

const ids = (plugins: readonly PluginDefinition[]) => plugins.map((p) => p.id);

describe('resolvePlugins', () => {
  const a = plugin('test.a');
  const b = plugin('test.b', ['test.a']);
  const c = plugin('test.c', ['test.b', 'test.missing?']);

  it('enables everything by default and puts dependencies first', () => {
    expect(ids(resolvePlugins([c, b, a]))).toEqual(['test.a', 'test.b', 'test.c']);
  });

  it('keeps registration order for independent plugins', () => {
    const x = plugin('test.x');
    expect(ids(resolvePlugins([x, a]))).toEqual(['test.x', 'test.a']);
  });

  it('enables only the listed plugins', () => {
    expect(ids(resolvePlugins([a, b, c], 'test.a, test.b'))).toEqual(['test.a', 'test.b']);
  });

  it('supports exclusions', () => {
    expect(ids(resolvePlugins([a, b, c], '-test.c'))).toEqual(['test.a', 'test.b']);
  });

  it('skips a disabled optional dependency', () => {
    const d = plugin('test.d', ['test.a?']);
    expect(ids(resolvePlugins([a, d], 'test.d'))).toEqual(['test.d']);
  });

  it.each([
    ['a mix of inclusions and exclusions', 'test.a,-test.b', /not both/],
    ['an unknown plugin', 'test.nope', /unknown plugin "test.nope"/],
    ['an unknown exclusion', '-test.nope', /unknown plugin "test.nope"/],
    ['a disabled required dependency', '-test.a', /requires "test.a", which is disabled/],
  ])('rejects %s', (_name, selection, error) => {
    expect(() => resolvePlugins([a, b, c], selection)).toThrow(error);
  });

  it('rejects a missing required dependency', () => {
    expect(() => resolvePlugins([b])).toThrow(/requires "test.a", which is not installed/);
  });

  it('rejects dependency cycles', () => {
    const x = plugin('test.x', ['test.y']);
    const y = plugin('test.y', ['test.x']);
    expect(() => resolvePlugins([x, y])).toThrow(PluginLoadError);
    expect(() => resolvePlugins([x, y])).toThrow(/test.x -> test.y -> test.x/);
  });

  it('rejects duplicate and reserved ids', () => {
    expect(() => resolvePlugins([a, plugin('test.a')])).toThrow(/registered twice/);
    expect(() => resolvePlugins([plugin('outpost.core')])).toThrow(/reserved/);
  });
});
