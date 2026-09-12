import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

describe('loadConfig', () => {
  it('uses defaults when nothing is set', () => {
    expect(loadConfig({})).toEqual({
      env: 'development',
      host: '0.0.0.0',
      port: 3000,
      logLevel: 'info',
      trustProxy: false,
      databaseUrl: 'sqlite://./.data/outpost.db',
      plugins: undefined,
      webDir: undefined,
      version: '0.0.0-dev',
    });
  });

  it('parses provided values', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      OUTPOST_PORT: '8080',
      OUTPOST_TRUST_PROXY: 'true',
      OUTPOST_LOG_LEVEL: 'debug',
      OUTPOST_PLUGINS: '-outpost.about',
    });
    expect(config).toMatchObject({
      env: 'production',
      port: 8080,
      trustProxy: true,
      logLevel: 'debug',
      plugins: '-outpost.about',
    });
  });

  it('treats empty variables as unset', () => {
    expect(loadConfig({ OUTPOST_PORT: '', OUTPOST_WEB_DIR: '' })).toMatchObject({
      port: 3000,
      webDir: undefined,
    });
  });

  it('reports every invalid variable at once', () => {
    const load = () => loadConfig({ OUTPOST_PORT: '70000', OUTPOST_TRUST_PROXY: 'yes' });
    expect(load).toThrow(ConfigError);
    expect(load).toThrow(/OUTPOST_PORT[\s\S]*OUTPOST_TRUST_PROXY/);
  });
});
