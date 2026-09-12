import { HttpError } from '@outpost/plugin-api';
import {
  API_PREFIX,
  EXTERNAL_AUTH_RETURN_PATH,
  externalAuthStartResultSchema,
  externalAuthStartSchema,
  type ExternalAuthIntent,
} from '@outpost/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SecretBox } from '../auth/crypto.js';
import { findIdentity, linkIdentity, listIdentities, touchIdentity } from '../auth/identities.js';
import { acceptInvitation, findPendingInvitation, InvitationError } from '../auth/invitations.js';
import {
  newFlowSecrets,
  ProviderError,
  signupAllowed,
  type ExternalProfile,
  type ExternalProvider,
  type ProviderErrorCode,
} from '../auth/providers.js';
import type { AuthService } from '../auth/service.js';
import {
  availableUsername,
  createUser,
  findUserById,
  findUserByUsername,
  type UserRow,
} from '../auth/users.js';

/** Holds the secrets of a login at a provider between the start and the callback. */
const FLOW_COOKIE = 'outpost_auth_flow';
const FLOW_TTL_MS = 10 * 60_000;
const PROVIDERS_PATH = `${API_PREFIX}/auth/providers`;

const flowSchema = z.object({
  provider: z.string(),
  intent: z.enum(['login', 'link', 'sudo', 'invite']),
  secrets: z.object({ state: z.string(), codeVerifier: z.string(), nonce: z.string() }),
  /** The session that started a `link` or `sudo` flow; the callback must come back to it. */
  sessionId: z.string().nullable(),
  invitation: z.object({ token: z.string(), username: z.string() }).nullable(),
  expiresAt: z.number(),
});
type Flow = z.infer<typeof flowSchema>;

type FailureCode =
  | ProviderErrorCode
  | 'flow_expired'
  | 'not_linked'
  | 'account_disabled'
  | 'identity_in_use'
  | 'already_linked'
  | 'invitation_invalid'
  | 'username_taken'
  | 'internal_error';

/** Ends a callback with an error shown to the user. */
class CallbackFailure extends Error {
  override name = 'CallbackFailure';

  constructor(readonly code: FailureCode) {
    super(code);
  }
}

/**
 * Login with external providers. The web UI asks `start` for the provider URL and sends the
 * browser there; the provider sends it back to `callback`, which finishes the login and redirects
 * to the web UI (`/auth/return?intent=…&error=…`).
 */
export function registerExternalAuthRoutes(fastify: FastifyInstance, auth: AuthService): void {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const tags = ['auth'];
  const flows = new SecretBox(auth.config.secretKey, 'auth-flows');
  const params = z.object({ provider: z.string() });
  const cookieOptions = {
    path: `${PROVIDERS_PATH}/`,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: auth.secureCookies,
  };
  const callbackUrl = (provider: ExternalProvider) =>
    `${auth.config.publicUrl}${PROVIDERS_PATH}/${provider.id}/callback`;

  function readFlow(cookie: string | undefined): Flow | null {
    if (cookie === undefined) return null;
    try {
      const flow = flowSchema.parse(JSON.parse(flows.open(cookie)));
      return flow.expiresAt > Date.now() ? flow : null;
    } catch {
      return null;
    }
  }

  app.post(
    `${PROVIDERS_PATH}/:provider/start`,
    {
      schema: {
        tags,
        params,
        body: externalAuthStartSchema,
        response: { 200: externalAuthStartResultSchema },
      },
    },
    async (request, reply) => {
      const provider = auth.providers.get(request.params.provider);
      if (provider === undefined) {
        throw new HttpError(404, 'unknown_provider', 'This login provider is not configured');
      }
      const body = request.body;
      let sessionId: string | null = null;
      let invitation: Flow['invitation'] = null;
      if (body.intent === 'link') {
        // A new login method is sensitive: a stolen session must not add one for its thief.
        sessionId = auth.requireUser(request, { allowEnrollment: true, sudo: true }).session.id;
      } else if (body.intent === 'sudo') {
        const ctx = auth.requireUser(request, { allowEnrollment: true });
        if (ctx.user.password_hash !== null) {
          throw new HttpError(400, 'password_required', 'Confirm with your password');
        }
        sessionId = ctx.session.id;
      } else if (body.intent === 'invite') {
        if ((await findPendingInvitation(auth.db, body.token)) === undefined) {
          throw new HttpError(
            404,
            'invitation_invalid',
            new InvitationError('invitation_invalid').message,
          );
        }
        if ((await findUserByUsername(auth.db, body.username)) !== undefined) {
          throw new HttpError(409, 'username_taken', 'This username is taken');
        }
        invitation = { token: body.token, username: body.username };
      }

      const secrets = newFlowSecrets();
      let url: URL;
      try {
        url = await provider.authorizationUrl(
          callbackUrl(provider),
          secrets,
          body.intent === 'sudo',
        );
      } catch (err) {
        request.log.warn({ err, provider: provider.id }, 'login provider unavailable');
        throw new HttpError(502, 'provider_unavailable', 'The login provider cannot be reached');
      }
      const flow: Flow = {
        provider: provider.id,
        intent: body.intent,
        secrets,
        sessionId,
        invitation,
        expiresAt: Date.now() + FLOW_TTL_MS,
      };
      reply.setCookie(FLOW_COOKIE, flows.seal(JSON.stringify(flow)), {
        ...cookieOptions,
        maxAge: FLOW_TTL_MS / 1000,
      });
      return { url: url.href };
    },
  );

  app.get(
    `${PROVIDERS_PATH}/:provider/callback`,
    { schema: { tags, params } },
    async (request, reply) => {
      const flow = readFlow(request.cookies[FLOW_COOKIE]);
      reply.clearCookie(FLOW_COOKIE, { path: cookieOptions.path });
      const intent: ExternalAuthIntent = flow?.intent ?? 'login';
      try {
        const provider = auth.providers.get(request.params.provider);
        if (flow === null || provider === undefined || flow.provider !== provider.id) {
          throw new CallbackFailure('flow_expired');
        }
        // The URL the provider redirected to, as the browser saw it (for the token request).
        const currentUrl = new URL(request.url, auth.config.publicUrl);
        const profile = await provider.finish(currentUrl, flow.secrets, flow.intent === 'sudo');
        await handlers[flow.intent](request, reply, provider, profile, flow);
        return await reply.redirect(`${EXTERNAL_AUTH_RETURN_PATH}?intent=${intent}`);
      } catch (err) {
        let code: FailureCode;
        if (err instanceof CallbackFailure || err instanceof ProviderError) code = err.code;
        else if (err instanceof InvitationError) code = err.code;
        else code = 'internal_error';
        if (err instanceof ProviderError || code === 'internal_error') {
          request.log[code === 'internal_error' ? 'error' : 'warn'](
            { err, provider: request.params.provider },
            'login with a provider failed',
          );
        }
        await auth.audit.record({
          action: 'auth.external_login_failed',
          userId: request.auth?.user.id ?? null,
          ip: request.ip,
          details: { provider: request.params.provider, intent, reason: code },
        });
        return reply.redirect(`${EXTERNAL_AUTH_RETURN_PATH}?intent=${intent}&error=${code}`);
      }
    },
  );

  type Handler = (
    request: FastifyRequest,
    reply: FastifyReply,
    provider: ExternalProvider,
    profile: ExternalProfile,
    flow: Flow,
  ) => Promise<void>;

  /** The signed-in session that started a `link` or `sudo` flow. */
  function startingSession(request: FastifyRequest, flow: Flow) {
    const ctx = request.auth;
    if (ctx === null || ctx.session.status !== 'active' || ctx.session.id !== flow.sessionId) {
      throw new CallbackFailure('flow_expired');
    }
    return ctx;
  }

  const handlers: Record<ExternalAuthIntent, Handler> = {
    async login(request, reply, provider, profile) {
      const identity = await findIdentity(auth.db, provider.id, profile.subject);
      let user: UserRow | undefined;
      if (identity !== undefined) {
        user = await findUserById(auth.db, identity.user_id);
        await touchIdentity(auth.db, identity, profile.displayName);
      } else if (signupAllowed(provider.signup, profile)) {
        user = await signUp(provider, profile);
        await auth.audit.record({
          action: 'auth.signup',
          userId: user.id,
          ip: request.ip,
          details: { provider: provider.id },
        });
      }
      if (user === undefined) throw new CallbackFailure('not_linked');
      if (user.disabled_at !== null) throw new CallbackFailure('account_disabled');
      await auth.signIn(request, reply, user, {
        method: 'external',
        provider: provider.id,
        externalMfa: profile.mfa,
      });
    },

    async link(request, _reply, provider, profile, flow) {
      const { user } = startingSession(request, flow);
      const identity = await findIdentity(auth.db, provider.id, profile.subject);
      if (identity !== undefined) {
        if (identity.user_id !== user.id) throw new CallbackFailure('identity_in_use');
        await touchIdentity(auth.db, identity, profile.displayName);
        return;
      }
      const linked = await listIdentities(auth.db, user.id);
      if (linked.some((entry) => entry.provider === provider.id)) {
        throw new CallbackFailure('already_linked');
      }
      await linkIdentity(auth.db, {
        userId: user.id,
        provider: provider.id,
        subject: profile.subject,
        displayName: profile.displayName,
      });
      await auth.audit.record({
        action: 'auth.identity_linked',
        userId: user.id,
        ip: request.ip,
        details: { provider: provider.id },
      });
    },

    async sudo(request, _reply, provider, profile, flow) {
      const ctx = startingSession(request, flow);
      const identity = await findIdentity(auth.db, provider.id, profile.subject);
      if (identity === undefined || identity.user_id !== ctx.user.id) {
        throw new CallbackFailure('reauthentication_failed');
      }
      await touchIdentity(auth.db, identity, profile.displayName);
      await auth.sessions.startSudo(ctx.session);
      await auth.audit.record({
        action: 'auth.sudo',
        userId: ctx.user.id,
        ip: request.ip,
        details: { method: 'external', provider: provider.id },
      });
    },

    async invite(request, reply, provider, profile, flow) {
      if (flow.invitation === null) throw new CallbackFailure('invitation_invalid');
      // The person already has an account with this login: they should sign in with it.
      if ((await findIdentity(auth.db, provider.id, profile.subject)) !== undefined) {
        throw new CallbackFailure('identity_in_use');
      }
      const { user, invitation } = await acceptInvitation(auth.db, {
        token: flow.invitation.token,
        username: flow.invitation.username,
        passwordHash: null,
        identity: {
          provider: provider.id,
          subject: profile.subject,
          displayName: profile.displayName,
        },
      });
      await auth.audit.record({
        action: 'auth.invitation_accepted',
        userId: user.id,
        target: invitation.id,
        ip: request.ip,
        details: { provider: provider.id },
      });
      await auth.signIn(request, reply, user, {
        method: 'external',
        provider: provider.id,
        externalMfa: profile.mfa,
      });
    },
  };

  /** Creates an account for a profile allowed by the signup rules. */
  async function signUp(provider: ExternalProvider, profile: ExternalProfile): Promise<UserRow> {
    const username = await availableUsername(auth.db, [profile.username, ...profile.emails]);
    return auth.db.transaction().execute(async (trx) => {
      const user = await createUser(trx, { username, passwordHash: null, isSuperadmin: false });
      await linkIdentity(trx, {
        userId: user.id,
        provider: provider.id,
        subject: profile.subject,
        displayName: profile.displayName,
      });
      return user;
    });
  }
}
