# Authentication and security

## First start

A fresh Outpost has no accounts. Until the first administrator exists, anyone who can reach the
instance could claim it, so creating that account needs a **setup token**:

- by default a random token is printed to the server log on every start, as long as no account
  exists (`docker logs <container>`);
- or set your own with `OUTPOST_SETUP_TOKEN` (useful for automated deployments).

Open Outpost in the browser, enter the token and choose a username and password.

## Invitations

Further accounts are created with invitation links. Administrators create them under
**Administration → Invitations**:

- an invitation creates one account, either a regular user or an administrator;
- it is valid for 1, 7 or 30 days and can be deleted before it is used;
- the link is shown once, right after it is created: the database stores only a hash of its token.

The invited person opens the link, chooses a username and then either sets a password or signs in
with GitHub or an OpenID Connect provider (see below), which becomes the login method of the new
account.

## Passwords

Passwords are stored as argon2id hashes (19 MiB memory, 2 iterations — the OWASP minimum). They
must be at least 10 characters long and must not contain the username. Changing the password signs
out all other sessions.

Accounts created through an external login have no password; they can set one on the account page.

## Two-factor authentication

Accounts can protect their login with time-based one-time codes (TOTP, RFC 6238) from any
authenticator app. Turning it on shows a QR code and ten single-use **backup codes** for the case
that the app is lost; new backup codes can be generated at any time.

With `OUTPOST_REQUIRE_2FA_FOR_ADMINS=true` (the default), administrators must turn on two-factor
authentication right after their first login and cannot turn it off. TOTP keys are encrypted in the
database with a key derived from `OUTPOST_SECRET_KEY`, and a code is accepted only once.

A user who lost the authenticator and all backup codes asks an administrator: **Administration →
Users → Reset two-factor authentication** turns it off and signs the user out everywhere.

## External login (GitHub and OpenID Connect)

Besides passwords, Outpost can sign users in with a GitHub account or with any OpenID Connect
provider (Keycloak, Authentik, Authelia, Google, Microsoft Entra ID and others). The login button
appears for every configured provider. The variables are listed in the
[configuration](configuration.md#external-login).

### GitHub

1. On GitHub, open **Settings → Developer settings → OAuth Apps → New OAuth App** (of your account
   or of an organization).
2. Homepage URL: your `OUTPOST_PUBLIC_URL`. Authorization callback URL:
   `<OUTPOST_PUBLIC_URL>/api/v1/auth/providers/github/callback`.
3. Generate a client secret and set `OUTPOST_GITHUB_CLIENT_ID` and `OUTPOST_GITHUB_CLIENT_SECRET`.

Outpost asks GitHub for no permissions beyond the public profile, unless signup rules need them:
`user:email` to read verified email addresses, `read:org` to check organization membership.

### OpenID Connect

1. At the provider, create a client (often called "confidential client" or "web application") with
   the redirect URI `<OUTPOST_PUBLIC_URL>/api/v1/auth/providers/<id>/callback`.
2. Set `OUTPOST_OIDC_<ID>_ISSUER`, `OUTPOST_OIDC_<ID>_CLIENT_ID` and `OUTPOST_OIDC_<ID>_CLIENT_SECRET`.
   The issuer URL is the address the provider's `/.well-known/openid-configuration` lives under.

Outpost uses the authorization code flow with PKCE, `state` and `nonce`, and verifies the signed ID
token. It discovers the provider on the first login, so Outpost starts even while the provider is
down. The issuer should use HTTPS; an `http://` issuer is accepted only when configured that way,
for example for a provider on the same internal network.

### Who can sign in

An external account signs in to the Outpost account it is **linked** to. Accounts are linked in
three ways, never automatically by a matching email address:

- a signed-in user links the provider on the account page (**Linked accounts → Link**);
- an invited person accepts the invitation with the provider;
- **signup rules** let people create a regular user account by signing in:
  `*_SIGNUP_EMAILS` and `*_SIGNUP_DOMAINS` match verified email addresses (for OpenID Connect the ID
  token or user info must say `email_verified: true`), `OUTPOST_GITHUB_SIGNUP_ORGS` matches active
  members of GitHub organizations. Without signup rules nobody can create an account this way.

An external account can be linked to only one Outpost account, and each Outpost account to one
account per provider. A user cannot unlink the last way to sign in (a password or a provider).

### Two-factor authentication with external login

An external login does not skip Outpost's two-factor authentication: when it is on, Outpost asks for
the code after the provider. With `OUTPOST_OIDC_<ID>_TRUST_MFA=true`, a login for which the provider
reports multi-factor authentication (the ID token's `amr` claim contains `mfa`) counts as the second
factor: Outpost does not ask for its own code, and administrators do not have to set up Outpost's
two-factor authentication for such logins. Enable it only for providers that enforce their own
second factor. GitHub does not report how the user signed in, so this is not available for GitHub.

## Sessions

- The session cookie is `HttpOnly`, `SameSite=Lax` and `Secure` when `OUTPOST_PUBLIC_URL` uses
  HTTPS. The database stores only a hash of the session token.
- A session ends after 7 days without activity and after 30 days in any case.
- After the first login step, the second factor must be entered within 5 minutes.
- Every account page lists its active sessions and can sign them out.

## Sensitive actions

Turning two-factor authentication on or off, generating backup codes, linking and unlinking
external accounts, creating invitations and managing users require a confirmation in the last 10
minutes ("sudo mode"); a login counts as one. Otherwise the UI asks for it:

- accounts with a password enter the password;
- accounts without a password enter a two-factor code, or sign in with their linked provider
  again. OpenID Connect providers are asked for a fresh login (`prompt=login`) and the login must
  be at most 5 minutes old; GitHub only asks to pick the account again.

## User management

**Administration → Users** lists all accounts with their login methods, two-factor status and last
activity. Administrators can make users administrators and take the rights back, disable and enable
accounts (disabling signs the user out everywhere), reset two-factor authentication and delete
accounts. Their own account they change on the account page only, so that nobody locks themselves
out.

## Brute-force protection

- 5 wrong passwords for a username block further attempts for that username for 15 minutes.
- 30 failed attempts from one IP address block that address for 15 minutes.
- 5 wrong codes end a pending login; it has to start again with the password.
- Every IP address can send at most 600 requests per minute.

Behind a reverse proxy set `OUTPOST_TRUST_PROXY=true`, otherwise all requests appear to come from
the proxy's address.

## Web protections

- State-changing API requests must carry the `x-outpost-request: 1` header and, when the browser
  sends an `Origin`, come from `OUTPOST_PUBLIC_URL` (CSRF protection).
- Responses carry a strict Content Security Policy (scripts only from Outpost itself, no framing)
  and the usual security headers.
- External logins keep their `state`, PKCE verifier and `nonce` in an encrypted, short-lived cookie
  that is sent only to the callback, so a callback cannot be replayed in another browser.

## Audit log

Logins (with the method and provider), failed logins, logouts, password changes, 2FA changes,
revoked sessions, linked and unlinked accounts, accepted invitations and every administration action
(invitations, user changes) are written to the audit log together with the user and the client IP
address. Modules record their own actions there as well.
