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
      providers: [],
      auditRetentionDays: 180,
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

  it('configures GitHub login', () => {
    const config = loadConfig({
      OUTPOST_GITHUB_CLIENT_ID: 'id',
      OUTPOST_GITHUB_CLIENT_SECRET: 'secret',
      OUTPOST_GITHUB_SIGNUP_ORGS: 'Acme, other-org',
      OUTPOST_GITHUB_SIGNUP_DOMAINS: '@Example.com',
    });
    expect(config.providers).toEqual([
      {
        kind: 'github',
        id: 'github',
        name: 'GitHub',
        clientId: 'id',
        clientSecret: 'secret',
        signup: { emails: [], domains: ['example.com'], orgs: ['acme', 'other-org'] },
      },
    ]);
    expect(() => loadConfig({ OUTPOST_GITHUB_CLIENT_ID: 'id' })).toThrow(/set both/);
  });

  it('configures OIDC providers from their variables', () => {
    const config = loadConfig({
      OUTPOST_OIDC_MY_IDP_ISSUER: 'https://id.example.com/realms/main',
      OUTPOST_OIDC_MY_IDP_CLIENT_ID: 'outpost',
      OUTPOST_OIDC_MY_IDP_CLIENT_SECRET: 'secret',
      OUTPOST_OIDC_MY_IDP_TRUST_MFA: 'true',
      OUTPOST_OIDC_MY_IDP_SIGNUP_EMAILS: 'ann@example.com bob@example.com',
      OUTPOST_OIDC_AUTH_ISSUER: 'http://auth.internal',
      OUTPOST_OIDC_AUTH_CLIENT_ID: 'public-client',
      OUTPOST_OIDC_AUTH_NAME: 'Company login',
    });
    expect(config.providers).toEqual([
      {
        kind: 'oidc',
        id: 'auth',
        name: 'Company login',
        issuer: 'http://auth.internal',
        clientId: 'public-client',
        clientSecret: undefined,
        scopes: 'openid profile email',
        trustMfa: false,
        signup: { emails: [], domains: [], orgs: [] },
      },
      {
        kind: 'oidc',
        id: 'my-idp',
        name: 'My Idp',
        issuer: 'https://id.example.com/realms/main',
        clientId: 'outpost',
        clientSecret: 'secret',
        scopes: 'openid profile email',
        trustMfa: true,
        signup: { emails: ['ann@example.com', 'bob@example.com'], domains: [], orgs: [] },
      },
    ]);
  });

  it('reports incomplete and unknown OIDC variables', () => {
    const load = () =>
      loadConfig({
        OUTPOST_OIDC_A_CLIENT_ID: 'x',
        OUTPOST_OIDC_B_ISSUER: 'https://b.example.com',
        OUTPOST_OIDC_B_CLIENTID: 'typo',
        OUTPOST_OIDC_GITHUB_ISSUER: 'https://github.com',
      });
    expect(load).toThrow(ConfigError);
    expect(load).toThrow(/OUTPOST_OIDC_B_CLIENTID: unknown variable/);
    expect(load).toThrow(/OUTPOST_OIDC_A_ISSUER: required/);
    expect(load).toThrow(/OUTPOST_OIDC_B_CLIENT_ID: required/);
    expect(load).toThrow(/"github" is reserved/);
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
