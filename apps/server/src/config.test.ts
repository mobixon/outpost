import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const production = {
  NODE_ENV: 'production',
  OUTPOST_SECRET_KEY: 'x'.repeat(32),
  OUTPOST_PUBLIC_URL: 'https://outpost.example.com',
};

describe('loadConfig', () => {
  it('uses development defaults when nothing is set', () => {
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
      secretKey: expect.any(String),
      usingDevelopmentSecretKey: true,
      publicUrl: 'http://localhost:5173',
      requireTwoFactorForAdmins: true,
      setupToken: undefined,
    });
  });

  it('parses provided values', () => {
    const config = loadConfig({
      ...production,
      OUTPOST_PORT: '8080',
      OUTPOST_TRUST_PROXY: 'true',
      OUTPOST_LOG_LEVEL: 'debug',
      OUTPOST_PLUGINS: '-outpost.about',
      OUTPOST_REQUIRE_2FA_FOR_ADMINS: 'false',
    });
    expect(config).toMatchObject({
      env: 'production',
      port: 8080,
      trustProxy: true,
      logLevel: 'debug',
      plugins: '-outpost.about',
      secretKey: 'x'.repeat(32),
      usingDevelopmentSecretKey: false,
      publicUrl: 'https://outpost.example.com',
      requireTwoFactorForAdmins: false,
    });
  });

  it('requires a secret key and the public URL in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(
      /OUTPOST_SECRET_KEY[\s\S]*OUTPOST_PUBLIC_URL/,
    );
  });

  it('keeps only the origin of the public URL', () => {
    expect(loadConfig({ OUTPOST_PUBLIC_URL: 'https://outpost.example.com/panel/' }).publicUrl).toBe(
      'https://outpost.example.com',
    );
  });

  it('treats empty variables as unset', () => {
    expect(loadConfig({ OUTPOST_PORT: '', OUTPOST_WEB_DIR: '' })).toMatchObject({
      port: 3000,
      webDir: undefined,
    });
  });

  it('reports every invalid variable at once', () => {
    const load = () =>
      loadConfig({
        OUTPOST_PORT: '70000',
        OUTPOST_TRUST_PROXY: 'yes',
        OUTPOST_SECRET_KEY: 'short',
        OUTPOST_PUBLIC_URL: 'ftp://example.com',
      });
    expect(load).toThrow(ConfigError);
    expect(load).toThrow(
      /OUTPOST_PORT[\s\S]*OUTPOST_TRUST_PROXY[\s\S]*OUTPOST_SECRET_KEY[\s\S]*OUTPOST_PUBLIC_URL/,
    );
  });
});
