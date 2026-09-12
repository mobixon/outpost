# Outpost

Self-hosted, modular admin panel for game servers — it attaches to the servers you already run.
Minecraft: Java Edition comes first.

[![CI](https://github.com/mobixon/outpost/actions/workflows/ci.yml/badge.svg)](https://github.com/mobixon/outpost/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **Status: early development.** Nothing is usable yet. The [project plan](docs/PLAN.md) describes
> what is being built and in which order.

## Why Outpost

- **Attaches instead of taking over.** Connects to the servers you already run over RCON, wherever
  they run — no migration into a hosting panel. Deeper Docker integration follows later.
- **Modular.** Games and features are modules built on one public plugin API.
- **Secure by default.** 2FA, per-server roles, an audit log, and RCON stays on your private
  network.
- **Lightweight.** One container and SQLite by default; PostgreSQL is optional.

## Planned for v0.1

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

There are no published images yet. To build and run the current state:

```sh
docker build -t outpost .
docker run --rm -p 3000:3000 -v outpost-data:/data \
  -e OUTPOST_SECRET_KEY="$(openssl rand -base64 48)" \
  -e OUTPOST_PUBLIC_URL=http://localhost:3000 \
  outpost
```

Then open <http://localhost:3000> and create the administrator with the setup token printed in the
log. Settings are listed in [docs/configuration.md](docs/configuration.md), login and security in
[docs/authentication.md](docs/authentication.md). Keep the same `OUTPOST_SECRET_KEY` across restarts:
it encrypts secrets stored in the database.

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
