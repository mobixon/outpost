# Configuration

Outpost is configured with environment variables. Empty variables count as unset. Invalid values
stop Outpost at startup with a message that lists every problem.

| Variable              | Default                                                            | Description                                                                                                                |
| --------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | `sqlite://./.data/outpost.db` (image: `sqlite:///data/outpost.db`) | `sqlite:///absolute/path.db`, `sqlite://./relative/path.db` or `postgres://user:password@host:5432/database`               |
| `OUTPOST_HOST`        | `0.0.0.0`                                                          | Address to listen on                                                                                                       |
| `OUTPOST_PORT`        | `3000`                                                             | Port to listen on                                                                                                          |
| `OUTPOST_LOG_LEVEL`   | `info`                                                             | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`                                                             |
| `OUTPOST_TRUST_PROXY` | `false`                                                            | Set to `true` behind a reverse proxy (nginx, CapRover, Traefik) so client IPs come from `X-Forwarded-For`                  |
| `OUTPOST_PLUGINS`     | all built-in modules                                               | Comma-separated module ids to enable (`outpost.about`), or only exclusions (`-outpost.about`)                              |
| `OUTPOST_WEB_DIR`     | unset (image: `/app/public`)                                       | Directory with the built web UI. When unset, only the API is served — during development the UI comes from the Vite server |
| `OUTPOST_VERSION`     | `0.0.0-dev`                                                        | Version shown in the UI; set by the image build                                                                            |
| `NODE_ENV`            | `development` (image: `production`)                                | `development` enables human-readable logs                                                                                  |

## Database

SQLite needs no setup: the database file is created on first start. With the Docker image, mount a
volume at `/data` to keep it. PostgreSQL is supported through `DATABASE_URL`; the database must
exist, Outpost creates its tables.

Migrations run automatically on startup, for the core and for every enabled module.

## Health checks

- `GET /healthz` — liveness: the process answers (used by the image's `HEALTHCHECK`).
- `GET /readyz` — readiness: the database is reachable and all modules are set up; `503` otherwise.

The OpenAPI description of the HTTP API is served at `GET /api/v1/openapi.json`.
