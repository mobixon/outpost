# syntax=docker/dockerfile:1

# Build stage: the full Node image has the compilers better-sqlite3 may need for its native module.
FROM node:24-bookworm AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
RUN corepack enable
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=outpost-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store
RUN pnpm --filter @outpost/web --filter @outpost/server run build
# A self-contained copy of the server: its dist/ plus production dependencies only.
RUN --mount=type=cache,id=outpost-pnpm-store,target=/pnpm-store \
    pnpm --filter @outpost/server deploy --prod --store-dir /pnpm-store /out

# Runtime stage: same Debian release as the build stage, so the native module stays compatible.
FROM node:24-bookworm-slim
ARG OUTPOST_VERSION=0.0.0-dev
ENV NODE_ENV=production \
    OUTPOST_VERSION=$OUTPOST_VERSION \
    OUTPOST_PORT=3000 \
    OUTPOST_WEB_DIR=/app/public \
    DATABASE_URL=sqlite:///data/outpost.db
WORKDIR /app
COPY --from=build /out/ /app/
COPY --from=build /repo/apps/web/dist/ /app/public/
# UID 1000 (the image's "node" user) matches the default owner of itzg/minecraft-server files.
# /servers is the default OUTPOST_FILES_ROOT: folders of game servers are mounted below it.
RUN mkdir /data /servers && chown node:node /data /servers
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.OUTPOST_PORT}/healthz`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]
