FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --include=dev
COPY tsconfig.json ./
COPY src ./src
COPY assets ./assets
COPY elizaos.plugin.json ./
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV RUBY_HIGH_DATA_DIR=/data
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets
COPY scripts/server.mjs ./scripts/server.mjs
COPY elizaos.plugin.json ./
RUN mkdir -p /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/server.mjs"]
