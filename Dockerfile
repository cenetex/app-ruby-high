# node:24 ships node:sqlite as a first-class builtin (no --experimental-sqlite
# flag, unlike node:22). The SQLite state store relies on it. See
# docs/aws-exit-migration.md.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json* .npmrc ./
RUN npm ci --include=dev
COPY tsconfig.json tsup.config.ts ./
COPY scripts/check-privy-client-bundle.mjs ./scripts/check-privy-client-bundle.mjs
COPY scripts/check-viewer-bundle.mjs ./scripts/check-viewer-bundle.mjs
COPY scripts/fix-node-sqlite-import.mjs ./scripts/fix-node-sqlite-import.mjs
COPY src ./src
COPY assets ./assets
RUN npm run build

FROM node:24-slim AS runtime
WORKDIR /app
ARG RUBY_HIGH_BUILD=dev
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV RUBY_HIGH_BUILD=$RUBY_HIGH_BUILD
# RUBY_HIGH_DATA_DIR points the JSON fallback state-store at /data. Production
# selects SQLite via RUBY_HIGH_STORE_BACKEND and RUBY_HIGH_STATE_PATH in fly.toml.
ENV RUBY_HIGH_DATA_DIR=/data
COPY package.json package-lock.json* .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets
COPY landing ./landing
COPY scripts/server.mjs ./scripts/server.mjs
COPY scripts/http-limits.mjs ./scripts/http-limits.mjs
COPY scripts/landing.mjs ./scripts/landing.mjs
COPY scripts/public-base.mjs ./scripts/public-base.mjs
COPY scripts/migrate-dynamo-to-sqlite.mjs ./scripts/migrate-dynamo-to-sqlite.mjs
RUN mkdir -p /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/server.mjs"]
