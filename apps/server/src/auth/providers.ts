import * as oidc from 'openid-client';
import { z } from 'zod';
import type {
  GithubProviderConfig,
  OidcProviderConfig,
  ProviderConfig,
  SignupRules,
} from '../config.js';

/** What Outpost learns about a user from a provider. */
export interface ExternalProfile {
  /** The user's stable id at the provider. */
  subject: string;
  /** The account at the provider as its owner knows it: username or email address. */
  displayName: string | null;
  /** Suggestion for the username of a new Outpost account. */
  username: string | null;
  /** Verified email addresses, lowercase. */
  emails: string[];
  /** Organizations from the signup rules that the user is a member of (GitHub). */
  orgs: string[];
  /** The provider reports a multi-factor login and the settings trust it. */
  mfa: boolean;
}

/** Random values of one login attempt; they are kept in the flow cookie until the callback. */
export interface FlowSecrets {
  state: string;
  codeVerifier: string;
  nonce: string;
}

export function newFlowSecrets(): FlowSecrets {
  return {
    state: oidc.randomState(),
    codeVerifier: oidc.randomPKCECodeVerifier(),
    nonce: oidc.randomNonce(),
  };
}

export type ProviderErrorCode = 'access_denied' | 'provider_error' | 'reauthentication_failed';

/** The provider refused or failed the login; `code` tells the user what happened. */
export class ProviderError extends Error {
  override name = 'ProviderError';

  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface ExternalProvider {
  readonly id: string;
  readonly name: string;
  readonly signup: SignupRules;
  /** The provider page to send the browser to. `reauthenticate` asks for a fresh login there. */
  authorizationUrl(
    redirectUri: string,
    secrets: FlowSecrets,
    reauthenticate: boolean,
  ): Promise<URL>;
  /** Redeems the authorization code of the callback URL and returns the user's profile. */
  finish(callbackUrl: URL, secrets: FlowSecrets, reauthenticate: boolean): Promise<ExternalProfile>;
}

/** GitHub URLs; tests point them to a local fake. */
export interface GithubEndpoints {
  authorize: string;
  token: string;
  api: string;
}

export const GITHUB_ENDPOINTS: GithubEndpoints = {
  authorize: 'https://github.com/login/oauth/authorize',
  token: 'https://github.com/login/oauth/access_token',
  api: 'https://api.github.com',
};

export function createProviders(
  configs: readonly ProviderConfig[],
  github: GithubEndpoints = GITHUB_ENDPOINTS,
): Map<string, ExternalProvider> {
  return new Map(
    configs.map((config) => [
      config.id,
      config.kind === 'github' ? new GithubProvider(config, github) : new OidcProvider(config),
    ]),
  );
}

/** Whether the profile may create an account without an invitation. */
export function signupAllowed(rules: SignupRules, profile: ExternalProfile): boolean {
  return (
    profile.orgs.length > 0 ||
    profile.emails.some(
      (email) =>
        rules.emails.includes(email) || rules.domains.includes(email.slice(email.indexOf('@') + 1)),
    )
  );
}

const REQUEST_TIMEOUT_S = 10;
/** A re-authentication for sudo mode must not be older than this (ID token `auth_time`). */
const REAUTHENTICATION_MAX_AGE_S = 5 * 60;

async function withProviderErrors<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if (err instanceof oidc.AuthorizationResponseError && err.error === 'access_denied') {
      throw new ProviderError('access_denied', 'The login was cancelled at the provider', {
        cause: err,
      });
    }
    throw new ProviderError('provider_error', 'The login at the provider failed', { cause: err });
  }
}

function stringClaim(claims: Record<string, unknown>, name: string): string | null {
  const value = claims[name];
  return typeof value === 'string' && value !== '' ? value : null;
}

function verifiedEmail(claims: Record<string, unknown>): string | null {
  const email = stringClaim(claims, 'email');
  return email !== null && claims['email_verified'] === true ? email.toLowerCase() : null;
}

/** Client authentication at the token endpoint: HTTP Basic unless the provider only takes POST. */
function clientAuthentication(secret: string | undefined): oidc.ClientAuth {
  if (secret === undefined) return oidc.None();
  const basic = oidc.ClientSecretBasic(secret);
  const post = oidc.ClientSecretPost(secret);
  return (server, client, body, headers) => {
    const methods = server.token_endpoint_auth_methods_supported;
    // Without the list, OpenID Connect Discovery defines client_secret_basic as the default.
    const auth = methods === undefined || methods.includes('client_secret_basic') ? basic : post;
    auth(server, client, body, headers);
  };
}

/** A generic OpenID Connect provider (Keycloak, Authentik, Authelia, Google, …). */
class OidcProvider implements ExternalProvider {
  readonly id: string;
  readonly name: string;
  readonly signup: SignupRules;
  #configuration: Promise<oidc.Configuration> | undefined;

  constructor(private readonly settings: OidcProviderConfig) {
    this.id = settings.id;
    this.name = settings.name;
    this.signup = settings.signup;
  }

  // Discovered on first use, so that Outpost starts while the provider is unreachable.
  #discover(): Promise<oidc.Configuration> {
    this.#configuration ??= oidc
      .discovery(
        new URL(this.settings.issuer),
        this.settings.clientId,
        undefined,
        clientAuthentication(this.settings.clientSecret),
        {
          // Plain HTTP only when the administrator configured an http:// issuer.
          execute: this.settings.issuer.startsWith('http:') ? [oidc.allowInsecureRequests] : [],
          timeout: REQUEST_TIMEOUT_S,
        },
      )
      .catch((err: unknown) => {
        this.#configuration = undefined;
        throw err;
      });
    return this.#configuration;
  }

  async authorizationUrl(
    redirectUri: string,
    secrets: FlowSecrets,
    reauthenticate: boolean,
  ): Promise<URL> {
    const config = await this.#discover();
    const parameters: Record<string, string> = {
      redirect_uri: redirectUri,
      scope: this.settings.scopes,
      state: secrets.state,
      nonce: secrets.nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(secrets.codeVerifier),
      code_challenge_method: 'S256',
    };
    if (reauthenticate) parameters['prompt'] = 'login';
    return oidc.buildAuthorizationUrl(config, parameters);
  }

  finish(callbackUrl: URL, secrets: FlowSecrets, reauthenticate: boolean) {
    return withProviderErrors(async () => {
      const config = await this.#discover();
      const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
        pkceCodeVerifier: secrets.codeVerifier,
        expectedState: secrets.state,
        expectedNonce: secrets.nonce,
      });
      const claims = tokens.claims();
      if (claims === undefined) {
        throw new ProviderError('provider_error', 'The provider returned no ID token');
      }
      if (
        reauthenticate &&
        typeof claims.auth_time === 'number' &&
        Date.now() / 1000 - claims.auth_time > REAUTHENTICATION_MAX_AGE_S
      ) {
        throw new ProviderError('reauthentication_failed', 'The provider did not ask to sign in');
      }

      let email = verifiedEmail(claims);
      let username = stringClaim(claims, 'preferred_username');
      if ((email === null || username === null) && config.serverMetadata().userinfo_endpoint) {
        try {
          const info = await oidc.fetchUserInfo(config, tokens.access_token, claims.sub);
          email ??= verifiedEmail(info);
          username ??= stringClaim(info, 'preferred_username');
        } catch {
          // The ID token alone is enough to sign in.
        }
      }
      return {
        subject: claims.sub,
        displayName: username ?? email,
        username: username ?? email,
        emails: email === null ? [] : [email],
        orgs: [],
        mfa: this.settings.trustMfa && Array.isArray(claims.amr) && claims.amr.includes('mfa'),
      };
    });
  }
}

const githubUserSchema = z.object({ id: z.number(), login: z.string() });
const githubEmailsSchema = z.array(z.object({ email: z.string(), verified: z.boolean() }));
const githubMembershipSchema = z.object({ state: z.string() });

/** GitHub OAuth app. GitHub is not an OpenID Connect provider: the profile comes from its API. */
class GithubProvider implements ExternalProvider {
  readonly id = 'github';
  readonly name = 'GitHub';
  readonly signup: SignupRules;
  readonly #config: oidc.Configuration;
  readonly #scopes: string[] = [];

  constructor(
    settings: GithubProviderConfig,
    private readonly endpoints: GithubEndpoints,
  ) {
    this.signup = settings.signup;
    this.#config = new oidc.Configuration(
      {
        issuer: 'https://github.com',
        authorization_endpoint: endpoints.authorize,
        token_endpoint: endpoints.token,
      },
      settings.clientId,
      settings.clientSecret,
    );
    this.#config.timeout = REQUEST_TIMEOUT_S;
    if (endpoints.token.startsWith('http:')) oidc.allowInsecureRequests(this.#config);
    // Only what the signup rules need: the public profile needs no scope at all.
    if (this.signup.emails.length > 0 || this.signup.domains.length > 0) {
      this.#scopes.push('user:email');
    }
    if (this.signup.orgs.length > 0) this.#scopes.push('read:org');
  }

  async authorizationUrl(
    redirectUri: string,
    secrets: FlowSecrets,
    reauthenticate: boolean,
  ): Promise<URL> {
    const parameters: Record<string, string> = {
      redirect_uri: redirectUri,
      state: secrets.state,
      code_challenge: await oidc.calculatePKCECodeChallenge(secrets.codeVerifier),
      code_challenge_method: 'S256',
      allow_signup: 'false',
    };
    if (this.#scopes.length > 0) parameters['scope'] = this.#scopes.join(' ');
    // GitHub cannot force a new login; it can at least make the user choose the account again.
    if (reauthenticate) parameters['prompt'] = 'select_account';
    return oidc.buildAuthorizationUrl(this.#config, parameters);
  }

  finish(callbackUrl: URL, secrets: FlowSecrets) {
    return withProviderErrors(async () => {
      const tokens = await oidc.authorizationCodeGrant(this.#config, callbackUrl, {
        pkceCodeVerifier: secrets.codeVerifier,
        expectedState: secrets.state,
      });
      const token = tokens.access_token;
      const user = githubUserSchema.parse(await this.#api(token, '/user'));
      const emails = this.#scopes.includes('user:email')
        ? githubEmailsSchema
            .parse(await this.#api(token, '/user/emails'))
            .filter((entry) => entry.verified)
            .map((entry) => entry.email.toLowerCase())
        : [];
      const orgs: string[] = [];
      for (const org of this.signup.orgs) {
        const membership = await this.#api(
          token,
          `/user/memberships/orgs/${encodeURIComponent(org)}`,
          true,
        );
        if (githubMembershipSchema.safeParse(membership).data?.state === 'active') orgs.push(org);
      }
      return {
        subject: String(user.id),
        displayName: user.login,
        username: user.login,
        emails,
        orgs,
        mfa: false,
      };
    });
  }

  /** GET from the GitHub API; with `optional`, 403 and 404 give null. */
  async #api(token: string, path: string, optional = false): Promise<unknown> {
    const response = await fetch(`${this.endpoints.api}${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'Outpost',
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_S * 1000),
    });
    if (optional && (response.status === 403 || response.status === 404)) return null;
    if (!response.ok) {
      throw new ProviderError('provider_error', `GitHub API ${path} answered ${response.status}`);
    }
    return response.json();
  }
}
