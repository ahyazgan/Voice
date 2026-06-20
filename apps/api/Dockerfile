# =============================================================================
# apps/api/Dockerfile — REST API + BullMQ arama worker'ı
# =============================================================================
# Monorepo KÖKÜNDEN build:
#   docker build -f apps/api/Dockerfile -t voice-api .
# Prisma client builder'da generate edilir; üretilen .prisma/client runner'a taşınır.
# =============================================================================

FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile

COPY prisma ./prisma
COPY packages ./packages
COPY apps/api ./apps/api
# Prisma client + derleme (shared ÖNCE — api ona bağımlı).
RUN pnpm db:generate \
 && pnpm --filter @voice/shared build \
 && pnpm --filter @voice/api build

# --- Runner -----------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod

COPY prisma ./prisma
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/apps/api/dist apps/api/dist
# Generate edilmiş Prisma client (builder'daki node_modules/.prisma + @prisma/client engine).
COPY --from=builder /app/node_modules/.prisma node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client node_modules/@prisma/client

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/health || exit 1

# Migration'lar deploy adımında ayrı çalıştırılır: `pnpm db:migrate deploy`.
CMD ["node", "apps/api/dist/server.js"]
