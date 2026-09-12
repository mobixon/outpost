# Authentication and security

## First start

A fresh Outpost has no accounts. Until the first administrator exists, anyone who can reach the
instance could claim it, so creating that account needs a **setup token**:

- by default a random token is printed to the server log on every start, as long as no account
  exists (`docker logs <container>`);
- or set your own with `OUTPOST_SETUP_TOKEN` (useful for automated deployments).

Open Outpost in the browser, enter the token and choose a username and password.

## Passwords

Passwords are stored as argon2id hashes (19 MiB memory, 2 iterations — the OWASP minimum). They
must be at least 10 characters long and must not contain the username. Changing the password signs
out all other sessions.

## Two-factor authentication

Accounts can protect their login with time-based one-time codes (TOTP, RFC 6238) from any
authenticator app. Turning it on shows a QR code and ten single-use **backup codes** for the case
that the app is lost; new backup codes can be generated at any time.

With `OUTPOST_REQUIRE_2FA_FOR_ADMINS=true` (the default), administrators must turn on two-factor
authentication right after their first login and cannot turn it off. TOTP keys are encrypted in the
database with a key derived from `OUTPOST_SECRET_KEY`, and a code is accepted only once.

## Sessions

- The session cookie is `HttpOnly`, `SameSite=Lax` and `Secure` when `OUTPOST_PUBLIC_URL` uses
  HTTPS. The database stores only a hash of the session token.
- A session ends after 7 days without activity and after 30 days in any case.
- After the password, the second factor must be entered within 5 minutes.
- Every account page lists its active sessions and can sign them out.

## Sensitive actions

Turning two-factor authentication on or off and generating backup codes require the password to
have been entered in the last 10 minutes ("sudo mode"). Otherwise the UI asks for it again.

## Brute-force protection

- 5 wrong passwords for a username block further attempts for that username for 15 minutes.
- 30 failed attempts from one IP address block that address for 15 minutes.
- 5 wrong codes end a pending login; it has to start again with the password.

Behind a reverse proxy set `OUTPOST_TRUST_PROXY=true`, otherwise all requests appear to come from
the proxy's address.

## Web protections

- State-changing API requests must carry the `x-outpost-request: 1` header and, when the browser
  sends an `Origin`, come from `OUTPOST_PUBLIC_URL` (CSRF protection).
- Responses carry a strict Content Security Policy (scripts only from Outpost itself, no framing)
  and the usual security headers.

## Audit log

Logins, failed logins, logouts, password changes, 2FA changes and revoked sessions are written to
the audit log together with the user and the client IP address. Modules record their own actions
there as well.
