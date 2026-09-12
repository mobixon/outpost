#!/usr/bin/env sh
# Runs a command in a Node.js container with the repository mounted, for machines without Node.js.
#   scripts/in-docker.sh pnpm install
#   scripts/in-docker.sh pnpm check
# Extra `docker run` flags (e.g. published ports) can be passed via OUTPOST_DOCKER_ARGS.
set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
NODE_IMAGE=${OUTPOST_NODE_IMAGE:-node:24-bookworm}

TTY_FLAGS=""
if [ -t 0 ] && [ -t 1 ]; then
  TTY_FLAGS="-it"
fi

# The named volume keeps the Corepack and pnpm caches between runs. Corepack (bundled with Node 24)
# cannot write shims to /usr/local/bin as a non-root user, so they go to ~/.local/bin in the volume;
# that way `pnpm` also works inside package scripts.
# shellcheck disable=SC2086
exec docker run --rm $TTY_FLAGS \
  --user "$(id -u):$(id -g)" \
  -e HOME=/home/node \
  -e PATH=/home/node/.local/bin:/usr/local/bin:/usr/bin:/bin \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -v outpost-node-home:/home/node \
  -v "$ROOT":/repo \
  -w /repo \
  ${OUTPOST_DOCKER_ARGS:-} \
  "$NODE_IMAGE" \
  sh -c 'mkdir -p "$HOME/.local/bin" && corepack enable --install-directory "$HOME/.local/bin" && exec "$@"' \
  in-docker "$@"
