import { describe, expect, it } from 'vitest';
import {
  definePlugin,
  parseDependency,
  PLUGIN_API_VERSION,
  PluginDefinitionError,
  type Migration,
} from './index.js';

const migration = (name: string): Migration => ({ name, up: async () => {} });

describe('definePlugin', () => {
  const valid = { id: 'outpost.players', version: '0.1.0', apiVersion: PLUGIN_API_VERSION };

  it('returns a valid definition unchanged', () => {
    expect(definePlugin(valid)).toBe(valid);
  });

  it.each(['acme.discord-bridge', 'outpost.game-minecraft', 'a1.b2.c3'])('accepts id %j', (id) => {
    expect(definePlugin({ ...valid, id }).id).toBe(id);
  });

  it.each([
    'players',
    'Outpost.players',
    'outpost..players',
    'outpost.players-',
    'outpost_x.players',
  ])('rejects id %j', (id) => {
    expect(() => definePlugin({ ...valid, id })).toThrow(PluginDefinitionError);
  });

  it.each(['1', '1.0', 'v1.0.0', 'latest'])('rejects version %j', (version) => {
    expect(() => definePlugin({ ...valid, version })).toThrow(/invalid version/);
  });

  it('rejects an unsupported plugin API version', () => {
    expect(() => definePlugin({ ...valid, apiVersion: PLUGIN_API_VERSION + 1 })).toThrow(
      /targets plugin API/,
    );
  });

  it('accepts required and optional dependencies', () => {
    expect(() =>
      definePlugin({ ...valid, dependsOn: ['outpost.console', 'outpost.scheduler?'] }),
    ).not.toThrow();
  });

  it('rejects an invalid or self dependency', () => {
    expect(() => definePlugin({ ...valid, dependsOn: ['console'] })).toThrow(/invalid dependency/);
    expect(() => definePlugin({ ...valid, dependsOn: ['outpost.players?'] })).toThrow(/itself/);
  });

  it('accepts migrations in ascending order', () => {
    expect(() =>
      definePlugin({ ...valid, migrations: [migration('0001_init'), migration('0002_more')] }),
    ).not.toThrow();
  });

  it('rejects badly named, duplicate or unordered migrations', () => {
    expect(() => definePlugin({ ...valid, migrations: [migration('init')] })).toThrow(
      /invalid migration name/,
    );
    expect(() =>
      definePlugin({ ...valid, migrations: [migration('0002_b'), migration('0001_a')] }),
    ).toThrow(/ascending order/);
    expect(() =>
      definePlugin({ ...valid, migrations: [migration('0001_a'), migration('0001_a')] }),
    ).toThrow(/ascending order/);
  });
});

describe('parseDependency', () => {
  it('detects optional dependencies', () => {
    expect(parseDependency('outpost.console')).toEqual({ id: 'outpost.console', optional: false });
    expect(parseDependency('outpost.console?')).toEqual({ id: 'outpost.console', optional: true });
  });
});
