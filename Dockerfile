# syntax=docker/dockerfile:1
FROM docker.io/library/node:24-alpine AS base
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Production dependencies only (native modules like argon2 are built here).
FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

# One image, two processes: `node dist/main.js` (API, default) or `node dist/worker.js`.
FROM docker.io/library/node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node public ./public
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/main.js"]
