import { z } from 'zod';

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
  twoFactorEnabled: z.boolean(),
  backupCodesLeft: z.number().int(),
  createdAt: z.string(),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

export const sessionStateSchema = z.object({
  /** No account exists yet; the first administrator must be created with the setup token. */
  setupRequired: z.boolean(),
  /** `mfa`: the password was accepted and the second factor is pending. */
  status: z.enum(['anonymous', 'mfa', 'active']),
  user: currentUserSchema.nullable(),
  /** Signed in, but the account has to enable two-factor authentication before anything else. */
  twoFactorEnrollmentRequired: z.boolean(),
  /** Until when sensitive actions are allowed without confirming the password again. */
  sudoUntil: z.string().nullable(),
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

export const sudoRequestSchema = z.object({
  password: passwordInputSchema,
});

export const sudoResultSchema = z.object({
  sudoUntil: z.string(),
});

export const passwordChangeRequestSchema = z.object({
  currentPassword: passwordInputSchema,
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
