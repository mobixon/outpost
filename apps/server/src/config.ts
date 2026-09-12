import { z } from 'zod';

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const booleanFromString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

/** Used only outside production when OUTPOST_SECRET_KEY is not set. Never secure. */
const DEVELOPMENT_SECRET_KEY = 'outpost-insecure-development-secret-key';

// Variables are documented in docs/configuration.md — keep both in sync.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  OUTPOST_HOST: z.string().default('0.0.0.0'),
  OUTPOST_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  OUTPOST_LOG_LEVEL: z.enum(logLevels).default('info'),
  OUTPOST_TRUST_PROXY: booleanFromString.default(false),
  DATABASE_URL: z.string().default('sqlite://./.data/outpost.db'),
  OUTPOST_PLUGINS: z.string().optional(),
  OUTPOST_WEB_DIR: z.string().optional(),
  OUTPOST_VERSION: z.string().default('0.0.0-dev'),
  OUTPOST_SECRET_KEY: z.string().min(32).optional(),
  OUTPOST_PUBLIC_URL: z.url({ protocol: /^https?$/ }).optional(),
  OUTPOST_REQUIRE_2FA_FOR_ADMINS: booleanFromString.default(true),
  OUTPOST_SETUP_TOKEN: z.string().min(16).optional(),
});

export interface Config {
  env: 'development' | 'production' | 'test';
  host: string;
  port: number;
  logLevel: (typeof logLevels)[number];
  trustProxy: boolean;
  databaseUrl: string;
  /** Raw `OUTPOST_PLUGINS` selection; see `resolvePlugins`. */
  plugins: string | undefined;
  /** Directory with the built web UI; the UI is not served when unset (development uses Vite). */
  webDir: string | undefined;
  version: string;
  /** Key material for encrypting secrets in the database. */
  secretKey: string;
  usingDevelopmentSecretKey: boolean;
  /** Origin under which users open Outpost, e.g. `https://outpost.example.com`. */
  publicUrl: string;
  /** Superadmins must enable two-factor authentication before they can use the panel. */
  requireTwoFactorForAdmins: boolean;
  /** Fixed token for creating the first administrator; random and logged when unset. */
  setupToken: string | undefined;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/** Reads the configuration from environment variables. Empty variables count as unset. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const present = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = envSchema.safeParse(present);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `  ${issue.path.join('.')}: ${issue.message}`,
    );
    throw new ConfigError(`Invalid configuration:\n${problems.join('\n')}`);
  }
  const values = result.data;

  if (values.NODE_ENV === 'production') {
    const missing: string[] = [];
    if (values.OUTPOST_SECRET_KEY === undefined) {
      missing.push('  OUTPOST_SECRET_KEY: required in production (at least 32 random characters)');
    }
    if (values.OUTPOST_PUBLIC_URL === undefined) {
      missing.push(
        '  OUTPOST_PUBLIC_URL: required in production, e.g. https://outpost.example.com',
      );
    }
    if (missing.length > 0) throw new ConfigError(`Invalid configuration:\n${missing.join('\n')}`);
  }

  // In development the UI is served by Vite, which forwards API requests to this server.
  const defaultPublicUrl =
    values.NODE_ENV === 'development'
      ? 'http://localhost:5173'
      : `http://localhost:${values.OUTPOST_PORT}`;

  return {
    env: values.NODE_ENV,
    host: values.OUTPOST_HOST,
    port: values.OUTPOST_PORT,
    logLevel: values.OUTPOST_LOG_LEVEL,
    trustProxy: values.OUTPOST_TRUST_PROXY,
    databaseUrl: values.DATABASE_URL,
    plugins: values.OUTPOST_PLUGINS,
    webDir: values.OUTPOST_WEB_DIR,
    version: values.OUTPOST_VERSION,
    secretKey: values.OUTPOST_SECRET_KEY ?? DEVELOPMENT_SECRET_KEY,
    usingDevelopmentSecretKey: values.OUTPOST_SECRET_KEY === undefined,
    publicUrl: new URL(values.OUTPOST_PUBLIC_URL ?? defaultPublicUrl).origin,
    requireTwoFactorForAdmins: values.OUTPOST_REQUIRE_2FA_FOR_ADMINS,
    setupToken: values.OUTPOST_SETUP_TOKEN,
  };
}
