# Contributing to Outpost

Thanks for your interest in Outpost! The project is in early development, so for anything larger
than a small fix please open an issue first to discuss the idea. The [project plan](docs/PLAN.md)
explains the architecture and the order in which features are built.

## Development setup

### With Node.js

- Node.js 24 (see [`.node-version`](.node-version))
- pnpm via Corepack, which is bundled with Node.js 24: run `corepack enable` once

```sh
pnpm install
pnpm check
```

### With Docker only

[`scripts/in-docker.sh`](scripts/in-docker.sh) runs any command in a `node:24` container with the
repository mounted, as your own user:

```sh
scripts/in-docker.sh pnpm install
scripts/in-docker.sh pnpm check
```

### Commands

| Command             | What it does                                          |
| ------------------- | ----------------------------------------------------- |
| `pnpm lint`         | ESLint over the whole repository                      |
| `pnpm format`       | Format everything with Prettier                       |
| `pnpm format:check` | Check formatting without writing                      |
| `pnpm typecheck`    | TypeScript type check of every package                |
| `pnpm build`        | Build every package                                   |
| `pnpm test`         | Run the unit tests (Vitest)                           |
| `pnpm check`        | All of the above, in the same order as CI (no format) |

## Running Outpost locally

`pnpm dev` starts the API server (port 3000, restarts on changes) and the web UI (Vite, port 5173,
hot reload, proxies `/api` to the server). Open <http://localhost:5173>.

```sh
pnpm dev

# With Docker only: publish the Vite port
OUTPOST_DOCKER_ARGS="-p 5173:5173" scripts/in-docker.sh pnpm dev
```

The development database is `apps/server/.data/outpost.db` (SQLite); delete it to start from
scratch. All settings are described in [docs/configuration.md](docs/configuration.md).

## Repository layout

- `apps/` — the server (Fastify) and the web UI (Vue)
- `packages/` — public packages: plugin API contracts, shared schemas, shared UI components
- `plugins/` — built-in modules: drivers, game modules and features

**Module boundary:** code in `plugins/` may import only the public packages
(`@outpost/plugin-api`, `@outpost/web-plugin-api`, `@outpost/shared`, `@outpost/ui`), never
anything from `apps/`. ESLint enforces this, so built-in modules prove that the public API is
enough to write a plugin.

## Commits and pull requests

- Branch from `main`, e.g. `feat/console-stream`, `fix/rcon-reconnect`, `docs/install`.
- PR titles follow [Conventional Commits](https://www.conventionalcommits.org/) — CI checks this,
  and the title becomes the squash commit message. Common types: `feat`, `fix`, `docs`, `refactor`,
  `test`, `chore`, `ci`. Use a scope when it helps: `feat(players): …`.
- Keep one logical change per PR, with tests and docs updated.
- CI must be green before merging. PRs are squash-merged.

## Code style

- Prettier and ESLint decide formatting and most style questions.
- TypeScript in strict mode; avoid `any`.
- Code, comments and documentation are written in English. Comments explain _why_, not _what_.

## Reporting bugs and vulnerabilities

Use the issue templates for bugs and feature requests. Security issues must be reported privately —
see [SECURITY.md](SECURITY.md).

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating you agree to
uphold it.
