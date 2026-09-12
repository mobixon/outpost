import { HttpError, type AuthenticatedUser } from '@outpost/plugin-api';
import type { SessionState } from '@outpost/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { AuditLog } from '../audit.js';
import type { Config } from '../config.js';
import type { CoreTables } from '../db/schema.js';
import { hashBackupCode, looksLikeBackupCode } from './backup-codes.js';
import { SecretBox } from './crypto.js';
import type { ExternalProvider } from './providers.js';
import {
  MFA_PENDING_TTL_MS,
  SESSION_ABSOLUTE_TTL_MS,
  SessionStore,
  type ClientInfo,
  type SessionRow,
  type SessionStatus,
} from './sessions.js';
import { SetupGuard } from './setup.js';
import { FailureLimiter } from './throttle.js';
import { verifyTotp } from './totp.js';
import {
  claimTotpStep,
  consumeBackupCode,
  findUserById,
  toCurrentUser,
  type UserRow,
} from './users.js';

export const SESSION_COOKIE = 'outpost_session';

export interface AuthContext {
  session: SessionRow;
  user: UserRow;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Session and user of an API request; null when not signed in. */
    auth: AuthContext | null;
  }
}

export interface RequireUserOptions {
  /** Also allow accounts that still have to enable two-factor authentication (account pages). */
  allowEnrollment?: boolean;
  /** Require a recent password confirmation (sudo mode). */
  sudo?: boolean;
}

export interface SignInDetails {
  /** How the first login step was passed: `password`, `invitation` or `external`. */
  method: string;
  /** Id of the external provider. */
  provider?: string;
  /** A trusted provider did a multi-factor login, which replaces Outpost's own second factor. */
  externalMfa?: boolean;
}

export function toAuthenticatedUser(user: UserRow): AuthenticatedUser {
  return { id: user.id, username: user.username, isSuperadmin: user.is_superadmin === 1 };
}

export class AuthService {
  readonly sessions: SessionStore;
  readonly setup: SetupGuard;
  readonly totpSecrets: SecretBox;
  /** Wrong passwords per username (login and password confirmations). */
  readonly passwordFailures = new FailureLimiter(5, 15 * 60_000);
  /** Failed logins and setup attempts per client IP. */
  readonly ipFailures = new FailureLimiter(30, 15 * 60_000);
  /** Wrong second-factor codes per pending login. */
  readonly codeFailures = new FailureLimiter(5, MFA_PENDING_TTL_MS);
  readonly #secureCookies: boolean;

  constructor(
    readonly db: Kysely<CoreTables>,
    readonly config: Config,
    readonly audit: AuditLog,
    /** External login providers by id. */
    readonly providers: ReadonlyMap<string, ExternalProvider> = new Map(),
  ) {
    this.sessions = new SessionStore(db);
    this.setup = new SetupGuard(config.setupToken);
    this.totpSecrets = new SecretBox(config.secretKey, 'totp-secrets');
    this.#secureCookies = config.publicUrl.startsWith('https:');
  }

  get secureCookies(): boolean {
    return this.#secureCookies;
  }

  enrollmentRequired({ user, session }: AuthContext): boolean {
    return (
      this.config.requireTwoFactorForAdmins &&
      user.is_superadmin === 1 &&
      user.totp_enabled_at === null &&
      session.external_mfa === 0
    );
  }

  /** Loads session and user from the session cookie. */
  async authenticate(request: FastifyRequest): Promise<AuthContext | null> {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return null;
    const session = await this.sessions.findByToken(token);
    if (session === undefined) return null;
    const user = await findUserById(this.db, session.user_id);
    if (user === undefined || user.disabled_at !== null) {
      await this.sessions.delete(session.id);
      return null;
    }
    await this.sessions.touch(session);
    return { session, user };
  }

  /** The signed-in user of the request, or an error response (401/403). */
  requireUser(request: FastifyRequest, options: RequireUserOptions = {}): AuthContext {
    const ctx = request.auth;
    if (ctx === null || ctx.session.status !== 'active') {
      throw new HttpError(401, 'unauthenticated', 'Sign in to continue');
    }
    if (!options.allowEnrollment && this.enrollmentRequired(ctx)) {
      throw new HttpError(
        403,
        'two_factor_enrollment_required',
        'Enable two-factor authentication to continue',
      );
    }
    if (options.sudo) this.assertSudo(ctx);
    return ctx;
  }

  /** Like requireUser, for instance administration. */
  requireSuperadmin(request: FastifyRequest, options: { sudo?: boolean } = {}): AuthContext {
    const ctx = this.requireUser(request);
    if (ctx.user.is_superadmin !== 1) {
      throw new HttpError(403, 'forbidden', 'Only administrators can do this');
    }
    if (options.sudo) this.assertSudo(ctx);
    return ctx;
  }

  assertSudo(ctx: AuthContext): void {
    if ((ctx.session.sudo_until ?? 0) <= Date.now()) {
      throw new HttpError(403, 'sudo_required', 'Confirm your password to continue');
    }
  }

  async sessionState(request: FastifyRequest): Promise<SessionState> {
    const ctx = request.auth;
    const base = {
      setupRequired: this.setup.required,
      twoFactorEnrollmentRequired: false,
      providers: [...this.providers.values()].map(({ id, name }) => ({ id, name })),
    };
    if (ctx === null) return { ...base, status: 'anonymous', user: null, sudoUntil: null };
    if (ctx.session.status === 'mfa')
      return { ...base, status: 'mfa', user: null, sudoUntil: null };
    const sudoUntil = ctx.session.sudo_until;
    return {
      ...base,
      status: 'active',
      user: await toCurrentUser(this.db, ctx.user),
      twoFactorEnrollmentRequired: this.enrollmentRequired(ctx),
      sudoUntil:
        sudoUntil !== null && sudoUntil > Date.now() ? new Date(sudoUntil).toISOString() : null,
    };
  }

  /**
   * Starts a session for a user who passed the first login step. With two-factor authentication
   * on, the session waits for the code, unless a trusted provider already did a multi-factor login.
   */
  async signIn(
    request: FastifyRequest,
    reply: FastifyReply,
    user: UserRow,
    details: SignInDetails,
  ): Promise<SessionStatus> {
    // A new login always gets a new session, never the one the browser brought along.
    if (request.auth !== null) await this.sessions.delete(request.auth.session.id);
    const externalMfa = details.externalMfa ?? false;
    const status: SessionStatus = user.totp_enabled_at !== null && !externalMfa ? 'mfa' : 'active';
    const { token } = await this.sessions.create(user.id, status, this.client(request), {
      sudo: status === 'active',
      externalMfa,
    });
    this.setSessionCookie(reply, token, status);
    if (status === 'active') {
      await this.audit.record({
        action: 'auth.login',
        userId: user.id,
        ip: request.ip,
        details: {
          method: details.method,
          ...(details.provider !== undefined && { provider: details.provider }),
          ...(externalMfa && { externalMfa }),
        },
      });
    }
    return status;
  }

  setSessionCookie(reply: FastifyReply, token: string, status: SessionStatus): void {
    const lifetime = status === 'mfa' ? MFA_PENDING_TTL_MS : SESSION_ABSOLUTE_TTL_MS;
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: this.#secureCookies,
      maxAge: lifetime / 1000,
    });
  }

  clearSessionCookie(reply: FastifyReply): void {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  /** Answers 429 with Retry-After while any of the keys is blocked. */
  assertNotBlocked(reply: FastifyReply, ...checks: [FailureLimiter, string][]): void {
    const wait = Math.max(0, ...checks.map(([limiter, key]) => limiter.blockedFor(key)));
    if (wait > 0) {
      reply.header('retry-after', Math.ceil(wait / 1000));
      throw new HttpError(429, 'too_many_attempts', 'Too many attempts. Try again later.');
    }
  }

  /** Checks and consumes an authenticator code or a backup code. */
  async verifySecondFactor(user: UserRow, code: string): Promise<'totp' | 'backup_code' | null> {
    if (user.totp_secret === null) return null;
    const digits = code.replace(/\s/g, '');
    if (/^\d{6}$/.test(digits)) {
      const secret = this.totpSecrets.open(user.totp_secret);
      const step = verifyTotp(secret, digits, Date.now(), user.totp_last_step);
      if (step === null || !(await claimTotpStep(this.db, user.id, step))) return null;
      user.totp_last_step = step;
      return 'totp';
    }
    if (
      looksLikeBackupCode(code) &&
      (await consumeBackupCode(this.db, user.id, hashBackupCode(code)))
    ) {
      return 'backup_code';
    }
    return null;
  }

  client(request: FastifyRequest): ClientInfo {
    return { ip: request.ip, userAgent: request.headers['user-agent'] };
  }
}
