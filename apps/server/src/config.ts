import { z } from 'zod';

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const booleanFromString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

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
  };
}
