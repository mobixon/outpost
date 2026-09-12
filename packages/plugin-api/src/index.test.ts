import { describe, expect, it } from 'vitest';
import { definePlugin, PLUGIN_API_VERSION, PluginDefinitionError } from './index.js';

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
});
