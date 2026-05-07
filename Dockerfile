# syntax=docker/dockerfile:1.7

# =============================================================================
# Stage 1 — builder : install full deps + compile NestJS
# =============================================================================
FROM node:22-alpine AS builder
RUN corepack enable \
 && corepack prepare pnpm@10.33.2 --activate \
 && apk add --no-cache python3 make g++ libc6-compat
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN pnpm build

# =============================================================================
# Stage 2 — prod-deps : install prod deps + drizzle-kit (runtime migrations)
# =============================================================================
FROM node:22-alpine AS prod-deps
RUN corepack enable \
 && corepack prepare pnpm@10.33.2 --activate \
 && apk add --no-cache python3 make g++ libc6-compat
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
# drizzle-kit + dotenv requis runtime pour `pnpm db:migrate`
# tsx requis pour `pnpm db:change-password` et autres scripts admin
RUN pnpm add drizzle-kit dotenv tsx

# =============================================================================
# Stage 3 — runner : image minimale, non-root, tini PID 1
# =============================================================================
FROM node:22-alpine AS runner
RUN corepack enable \
 && corepack prepare pnpm@10.33.2 --activate \
 && apk add --no-cache libc6-compat tini wget
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json pnpm-lock.yaml ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY drizzle ./drizzle
COPY drizzle.config.ts ./
COPY src/database/schema ./src/database/schema
COPY tsconfig.json ./

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:3000/api/health || exit 1

EXPOSE 3000
USER node

# tini en PID 1 pour gérer SIGTERM proprement (graceful shutdown NestJS)
ENTRYPOINT ["/sbin/tini", "--"]
# Migrations Drizzle idempotentes, puis bootstrap NestJS
CMD ["sh", "-c", "pnpm db:migrate && node dist/main.js"]
