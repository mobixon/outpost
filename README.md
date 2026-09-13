# Outpost

Self-hosted, modular admin panel for game servers — it attaches to the servers you already run.
Minecraft: Java Edition comes first.

[![CI](https://github.com/mobixon/outpost/actions/workflows/ci.yml/badge.svg)](https://github.com/mobixon/outpost/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **Status: preview.** The first pre-release, v0.1.0-rc.1, is being tested on a real server. Expect
> rough edges; the [project plan](docs/PLAN.md) describes what is being built and in which order.

## Why Outpost

- **Attaches instead of taking over.** Connects to the servers you already run over RCON, wherever
  they run — no migration into a hosting panel. Deeper Docker integration follows later.
- **Modular.** Games and features are modules built on one public plugin API.
- **Secure by default.** 2FA, per-server roles, an audit log, and RCON stays on your private
  network.
- **Lightweight.** One container and SQLite by default; PostgreSQL is optional.

## What v0.1 does

- **Console** — commands and chat messages over RCON, with the replies.
- **Players** — who is online, history, whitelist, ops, bans and kicks.
- **Scheduler** — cron-scheduled commands and rotating chat announcements.
- **Users and roles** — several users, per-server roles, local accounts with TOTP 2FA, invitation
  links, OIDC and GitHub login.
- **Connection over RCON**; a full connection through Docker (live log, files, autodiscovery) is on
  the roadmap.
- English and Russian interface.

What comes after v0.1 is listed in the [roadmap](docs/PLAN.md#18-roadmap-after-v01).

## Try it

```sh
docker run --rm -p 3000:3000 -v outpost-data:/data \
  -e OUTPOST_SECRET_KEY="$(openssl rand -base64 48)" \
  -e OUTPOST_PUBLIC_URL=http://localhost:3000 \
  ghcr.io/mobixon/outpost:0.1.0-rc.1
```

Then open <http://localhost:3000> and create the administrator with the setup token printed in the
log. For a real installation — Compose, a reverse proxy, CapRover, updates and backups — see
[docs/install.md](docs/install.md). Settings are listed in [docs/configuration.md](docs/configuration.md),
login and security in [docs/authentication.md](docs/authentication.md), servers, roles and modules
in [docs/servers.md](docs/servers.md). To build the image yourself: `docker build -t outpost .`

## Development

You need Node.js 24 with Corepack (bundled with Node.js), or just Docker:

```sh
# With Node.js
corepack enable
pnpm install
pnpm check

# With Docker only
scripts/in-docker.sh pnpm install
scripts/in-docker.sh pnpm check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and conventions.

## Security

Please report vulnerabilities privately — see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
