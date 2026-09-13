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
  OUTPOST_AUDIT_RETENTION_DAYS: z.coerce.number().int().min(0).default(180),
  OUTPOST_FILES_ROOT: z.string().default('/servers'),
  OUTPOST_GITHUB_CLIENT_ID: z.string().optional(),
  OUTPOST_GITHUB_CLIENT_SECRET: z.string().optional(),
  OUTPOST_GITHUB_SIGNUP_ORGS: z.string().optional(),
  OUTPOST_GITHUB_SIGNUP_EMAILS: z.string().optional(),
  OUTPOST_GITHUB_SIGNUP_DOMAINS: z.string().optional(),
});
type Env = z.infer<typeof envSchema>;

/**
 * Who may create an account by signing in with a provider. Everyone else needs an invitation or an
 * account that links the provider. All values are lowercase.
 */
export interface SignupRules {
  /** Verified email addresses. */
  emails: string[];
  /** Domains of verified email addresses. */
  domains: string[];
  /** GitHub organizations (GitHub only). */
  orgs: string[];
}

export interface GithubProviderConfig {
  kind: 'github';
  id: 'github';
  name: 'GitHub';
  clientId: string;
  clientSecret: string;
  signup: SignupRules;
}

export interface OidcProviderConfig {
  kind: 'oidc';
  /** From the variable names: `OUTPOST_OIDC_MY_IDP_ISSUER` gives `my-idp`. */
  id: string;
  name: string;
  issuer: string;
  clientId: string;
  /** Unset for public clients, which rely on PKCE alone. */
  clientSecret: string | undefined;
  scopes: string;
  /** A multi-factor login at the provider (`amr` contains `mfa`) replaces Outpost's own 2FA. */
  trustMfa: boolean;
  signup: SignupRules;
}

export type ProviderConfig = GithubProviderConfig | OidcProviderConfig;

const OIDC_SETTINGS = [
  'ISSUER',
  'CLIENT_ID',
  'CLIENT_SECRET',
  'NAME',
  'SCOPES',
  'TRUST_MFA',
  'SIGNUP_EMAILS',
  'SIGNUP_DOMAINS',
] as const;
type OidcSetting = (typeof OIDC_SETTINGS)[number];
const OIDC_VARIABLE = new RegExp(`^OUTPOST_OIDC_([A-Z0-9_]+?)_(${OIDC_SETTINGS.join('|')})$`);

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
  /** External login providers: GitHub first, then OIDC providers by id. */
  providers: ProviderConfig[];
  /** Audit log entries are deleted after this many days; 0 keeps them forever. */
  auditRetentionDays: number;
  /** Directory with the folders of game servers for the Files connector. */
  filesRoot: string;
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

  const problems: string[] = [];
  if (values.NODE_ENV === 'production') {
    if (values.OUTPOST_SECRET_KEY === undefined) {
      problems.push('  OUTPOST_SECRET_KEY: required in production (at least 32 random characters)');
    }
    if (values.OUTPOST_PUBLIC_URL === undefined) {
      problems.push(
        '  OUTPOST_PUBLIC_URL: required in production, e.g. https://outpost.example.com',
      );
    }
  }
  const providers = [...githubProvider(values, problems), ...oidcProviders(present, problems)];
  if (problems.length > 0) throw new ConfigError(`Invalid configuration:\n${problems.join('\n')}`);

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
    providers,
    auditRetentionDays: values.OUTPOST_AUDIT_RETENTION_DAYS,
    filesRoot: values.OUTPOST_FILES_ROOT,
  };
}

/** Comma- or space-separated values, lowercase. */
function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== '');
}

const domainList = (value: string | undefined) => list(value).map((item) => item.replace(/^@/, ''));

function githubProvider(values: Env, problems: string[]): GithubProviderConfig[] {
  const clientId = values.OUTPOST_GITHUB_CLIENT_ID;
  const clientSecret = values.OUTPOST_GITHUB_CLIENT_SECRET;
  if (clientId === undefined && clientSecret === undefined) return [];
  if (clientId === undefined || clientSecret === undefined) {
    problems.push(
      '  OUTPOST_GITHUB_CLIENT_ID, OUTPOST_GITHUB_CLIENT_SECRET: set both to enable GitHub login',
    );
    return [];
  }
  return [
    {
      kind: 'github',
      id: 'github',
      name: 'GitHub',
      clientId,
      clientSecret,
      signup: {
        emails: list(values.OUTPOST_GITHUB_SIGNUP_EMAILS),
        domains: domainList(values.OUTPOST_GITHUB_SIGNUP_DOMAINS),
        orgs: list(values.OUTPOST_GITHUB_SIGNUP_ORGS),
      },
    },
  ];
}

/** OIDC providers from `OUTPOST_OIDC_<ID>_<SETTING>` variables. */
function oidcProviders(
  env: Record<string, string | undefined>,
  problems: string[],
): OidcProviderConfig[] {
  const settingsById = new Map<string, Partial<Record<OidcSetting, string>>>();
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('OUTPOST_OIDC_') || value === undefined) continue;
    const match = OIDC_VARIABLE.exec(name);
    if (match === null) {
      problems.push(
        `  ${name}: unknown variable, expected OUTPOST_OIDC_<ID>_<${OIDC_SETTINGS.join('|')}>`,
      );
      continue;
    }
    const [, key = '', setting = 'ISSUER'] = match as unknown as [string, string, OidcSetting];
    settingsById.set(key, { ...settingsById.get(key), [setting]: value });
  }

  const providers: OidcProviderConfig[] = [];
  for (const [key, settings] of [...settingsById].sort(([a], [b]) => a.localeCompare(b))) {
    const prefix = `OUTPOST_OIDC_${key}`;
    const id = key.toLowerCase().replaceAll('_', '-');
    if (id === 'github') {
      problems.push(`  ${prefix}_*: the id "github" is reserved for OUTPOST_GITHUB_*`);
      continue;
    }
    const issuer = z.url({ protocol: /^https?$/ }).safeParse(settings.ISSUER);
    const trustMfa = booleanFromString.optional().safeParse(settings.TRUST_MFA);
    if (!issuer.success) problems.push(`  ${prefix}_ISSUER: required, the issuer URL`);
    if (settings.CLIENT_ID === undefined) problems.push(`  ${prefix}_CLIENT_ID: required`);
    if (!trustMfa.success) problems.push(`  ${prefix}_TRUST_MFA: expected true or false`);
    if (!issuer.success || settings.CLIENT_ID === undefined || !trustMfa.success) continue;
    providers.push({
      kind: 'oidc',
      id,
      name: settings.NAME ?? titleCase(id),
      issuer: issuer.data,
      clientId: settings.CLIENT_ID,
      clientSecret: settings.CLIENT_SECRET,
      scopes: settings.SCOPES ?? 'openid profile email',
      trustMfa: trustMfa.data ?? false,
      signup: {
        emails: list(settings.SIGNUP_EMAILS),
        domains: domainList(settings.SIGNUP_DOMAINS),
        orgs: [],
      },
    });
  }
  return providers;
}

const titleCase = (id: string) =>
  id
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
