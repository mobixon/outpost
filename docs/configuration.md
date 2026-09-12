# Configuration

Outpost is configured with environment variables. Empty variables count as unset. Invalid values
stop Outpost at startup with a message that lists every problem.

## Required in production

| Variable             | Description                                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OUTPOST_SECRET_KEY` | At least 32 random characters, e.g. `openssl rand -base64 48`. Encrypts secrets stored in the database (such as 2FA keys). Keep it stable and back it up. |
| `OUTPOST_PUBLIC_URL` | The address users open, e.g. `https://outpost.example.com`. Requests from other origins are rejected; `https` also enables secure cookies and HSTS.       |

Outside production (`NODE_ENV` other than `production`) Outpost starts without them, using an
insecure development key and `http://localhost:5173` (the Vite dev server) as the public URL.

## All variables

| Variable                         | Default                                                            | Description                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                   | `sqlite://./.data/outpost.db` (image: `sqlite:///data/outpost.db`) | `sqlite:///absolute/path.db`, `sqlite://./relative/path.db` or `postgres://user:password@host:5432/database`               |
| `OUTPOST_HOST`                   | `0.0.0.0`                                                          | Address to listen on                                                                                                       |
| `OUTPOST_PORT`                   | `3000`                                                             | Port to listen on                                                                                                          |
| `OUTPOST_LOG_LEVEL`              | `info`                                                             | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`                                                             |
| `OUTPOST_TRUST_PROXY`            | `false`                                                            | Set to `true` behind a reverse proxy (nginx, CapRover, Traefik) so client IPs come from `X-Forwarded-For`                  |
| `OUTPOST_SECRET_KEY`             | development key outside production                                 | See above                                                                                                                  |
| `OUTPOST_PUBLIC_URL`             | `http://localhost:5173` (development)                              | See above                                                                                                                  |
| `OUTPOST_REQUIRE_2FA_FOR_ADMINS` | `true`                                                             | Administrators must turn on two-factor authentication before they can use the panel                                        |
| `OUTPOST_SETUP_TOKEN`            | random, printed to the log                                         | Token for creating the first administrator (at least 16 characters). Useful for automated deployments                      |
| `OUTPOST_AUDIT_RETENTION_DAYS`   | `180`                                                              | Audit log entries older than this many days are deleted; `0` keeps them forever                                            |
| `OUTPOST_PLUGINS`                | all built-in modules                                               | Comma-separated module ids to enable (`outpost.about`), or only exclusions (`-outpost.about`)                              |
| `OUTPOST_WEB_DIR`                | unset (image: `/app/public`)                                       | Directory with the built web UI. When unset, only the API is served — during development the UI comes from the Vite server |
| `OUTPOST_VERSION`                | `0.0.0-dev`                                                        | Version shown in the UI; set by the image build                                                                            |
| `NODE_ENV`                       | `development` (image: `production`)                                | `development` enables human-readable logs; `production` requires the variables above                                       |

## External login

Login with GitHub and OpenID Connect providers is off until configured. See
[authentication](authentication.md#external-login-github-and-openid-connect) for the setup steps.

| Variable                           | Description                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| `OUTPOST_GITHUB_CLIENT_ID`         | Client ID of a GitHub OAuth app; together with the secret it enables "Continue with GitHub"       |
| `OUTPOST_GITHUB_CLIENT_SECRET`     | Client secret of the GitHub OAuth app                                                             |
| `OUTPOST_GITHUB_SIGNUP_ORGS`       | GitHub organizations whose members may create an account by signing in (comma-separated)          |
| `OUTPOST_GITHUB_SIGNUP_EMAILS`     | Verified email addresses that may create an account by signing in with GitHub                     |
| `OUTPOST_GITHUB_SIGNUP_DOMAINS`    | Domains of verified email addresses that may create an account by signing in with GitHub          |
| `OUTPOST_OIDC_<ID>_ISSUER`         | Issuer URL of an OpenID Connect provider, e.g. `https://id.example.com/realms/main` (required)    |
| `OUTPOST_OIDC_<ID>_CLIENT_ID`      | Client ID at the provider (required)                                                              |
| `OUTPOST_OIDC_<ID>_CLIENT_SECRET`  | Client secret; leave unset for a public client                                                    |
| `OUTPOST_OIDC_<ID>_NAME`           | Name on the login button (default: the id, e.g. `Keycloak`)                                       |
| `OUTPOST_OIDC_<ID>_SCOPES`         | Requested scopes (default `openid profile email`)                                                 |
| `OUTPOST_OIDC_<ID>_TRUST_MFA`      | `true`: a multi-factor login at the provider replaces Outpost's two-factor code (default `false`) |
| `OUTPOST_OIDC_<ID>_SIGNUP_EMAILS`  | Verified email addresses that may create an account by signing in with this provider              |
| `OUTPOST_OIDC_<ID>_SIGNUP_DOMAINS` | Domains of verified email addresses that may create an account by signing in with this provider   |

`<ID>` names the provider: `OUTPOST_OIDC_KEYCLOAK_ISSUER` configures the provider `keycloak`
(underscores become dashes), whose callback URL is
`<OUTPOST_PUBLIC_URL>/api/v1/auth/providers/keycloak/callback`. Any number of providers can be
configured this way. Unknown `OUTPOST_OIDC_*` variables stop Outpost at startup, to catch typos.

## Database

SQLite needs no setup: the database file is created on first start. With the Docker image, mount a
volume at `/data` to keep it. PostgreSQL is supported through `DATABASE_URL`; the database must
exist, Outpost creates its tables.

Migrations run automatically on startup, for the core and for every enabled module.

## Health checks

- `GET /healthz` — liveness: the process answers (used by the image's `HEALTHCHECK`).
- `GET /readyz` — readiness: the database is reachable and all modules are set up; `503` otherwise.

The OpenAPI description of the HTTP API is served at `GET /api/v1/openapi.json`.

See also: [authentication and security](authentication.md), [servers, roles and permissions](servers.md).
