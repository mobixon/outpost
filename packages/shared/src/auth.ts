import { z } from 'zod';
import { roleKeySchema } from './servers.js';

/** Header every state-changing API request must carry, with the value `1` (CSRF protection). */
export const CSRF_HEADER = 'x-outpost-request';

/** 3–32 characters: lowercase letters, digits, `.`, `_` and `-`, starting and ending with a letter or digit. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 256;

export const usernameSchema = z.string().trim().toLowerCase().regex(USERNAME_PATTERN);
export const newPasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
const passwordInputSchema = z.string().min(1).max(PASSWORD_MAX_LENGTH);
/** A 6-digit authenticator code or a backup code. */
const verificationCodeSchema = z.string().trim().min(6).max(32);

export const currentUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  isSuperadmin: z.boolean(),
  /** Accounts created through GitHub or OIDC have no password until they set one. */
  hasPassword: z.boolean(),
  twoFactorEnabled: z.boolean(),
  backupCodesLeft: z.number().int(),
  createdAt: z.string(),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

/** An external login provider (GitHub or an OpenID Connect provider). */
export const providerInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type ProviderInfo = z.infer<typeof providerInfoSchema>;

export const sessionStateSchema = z.object({
  /** No account exists yet; the first administrator must be created with the setup token. */
  setupRequired: z.boolean(),
  /** `mfa`: the first step of the login succeeded and the second factor is pending. */
  status: z.enum(['anonymous', 'mfa', 'active']),
  user: currentUserSchema.nullable(),
  /** Signed in, but the account has to enable two-factor authentication before anything else. */
  twoFactorEnrollmentRequired: z.boolean(),
  /** Until when sensitive actions are allowed without confirming the password again. */
  sudoUntil: z.string().nullable(),
  /** External login providers configured on this instance. */
  providers: z.array(providerInfoSchema),
});
export type SessionState = z.infer<typeof sessionStateSchema>;

export const setupRequestSchema = z.object({
  token: z.string().trim().min(1).max(200),
  username: usernameSchema,
  password: newPasswordSchema,
});

export const loginRequestSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(64),
  password: passwordInputSchema,
});

export const loginResultSchema = z.object({
  status: z.enum(['active', 'mfa']),
});

export const verificationRequestSchema = z.object({
  code: verificationCodeSchema,
});

/**
 * Accounts with a password confirm it; accounts without one confirm with a two-factor code (or
 * by signing in with their provider again, see `externalAuthStartSchema`).
 */
export const sudoRequestSchema = z
  .object({
    password: passwordInputSchema.optional(),
    code: verificationCodeSchema.optional(),
  })
  .refine((body) => (body.password === undefined) !== (body.code === undefined), {
    message: 'Send either the password or a code',
  });

export const sudoResultSchema = z.object({
  sudoUntil: z.string(),
});

/** `currentPassword` is required when the account has a password; setting a first one needs sudo. */
export const passwordChangeRequestSchema = z.object({
  currentPassword: passwordInputSchema.optional(),
  newPassword: newPasswordSchema,
});

export const twoFactorSetupSchema = z.object({
  /** Base32 secret for manual entry. */
  secret: z.string(),
  /** `otpauth://` URI for the QR code. */
  uri: z.string(),
});

export const backupCodesSchema = z.object({
  backupCodes: z.array(z.string()),
});

export const sessionInfoSchema = z.object({
  id: z.string(),
  current: z.boolean(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;

export const sessionListSchema = z.object({
  sessions: z.array(sessionInfoSchema),
});

/** Invitation tokens are 43 URL-safe characters; the limit only rejects garbage early. */
export const invitationTokenSchema = z.string().regex(/^[\w-]{20,100}$/);

/**
 * What a login through an external provider is for:
 * - `login`: sign in (or create an account when the provider settings allow it);
 * - `link`: add the provider as a login method of the signed-in account;
 * - `sudo`: confirm the identity for a sensitive action (accounts without a password);
 * - `invite`: accept an invitation and create the account with this provider as login method.
 */
export const externalAuthStartSchema = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('login') }),
  z.object({ intent: z.literal('link') }),
  z.object({ intent: z.literal('sudo') }),
  z.object({ intent: z.literal('invite'), token: invitationTokenSchema, username: usernameSchema }),
]);
export type ExternalAuthStart = z.infer<typeof externalAuthStartSchema>;
export type ExternalAuthIntent = ExternalAuthStart['intent'];

export const externalAuthStartResultSchema = z.object({
  /** Where to send the browser: the provider's authorization page. */
  url: z.string(),
});

/** Page the provider callback returns to, with `?intent=` and, on failure, `&error=<code>`. */
export const EXTERNAL_AUTH_RETURN_PATH = '/auth/return';

export const identityInfoSchema = z.object({
  provider: z.string(),
  providerName: z.string(),
  /** The account at the provider: its username or email address. */
  displayName: z.string().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type IdentityInfo = z.infer<typeof identityInfoSchema>;

export const identityListSchema = z.object({
  identities: z.array(identityInfoSchema),
});

/** What the invitation page shows before the invitation is accepted. */
export const invitationPreviewSchema = z.object({
  isSuperadmin: z.boolean(),
  /** The server the invitation makes the person a member of, with this role. */
  serverName: z.string().nullable(),
  role: roleKeySchema.nullable(),
  invitedBy: z.string().nullable(),
  expiresAt: z.string(),
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;

export const invitationAcceptSchema = z.object({
  username: usernameSchema,
  password: newPasswordSchema,
});
