# =============================================================================
# apps/voice-service/Dockerfile — Faz 1/2 ses orkestratörü
# =============================================================================
# Monorepo'nun KÖKÜNDEN build edilir (context = repo root):
#   docker build -f apps/voice-service/Dockerfile -t voice-service .
# Multi-stage: builder tüm workspace'i kurup derler, runner yalnızca prod
# bağımlılıkları + derlenmiş dist'i taşır (küçük imaj).
# =============================================================================

FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Workspace manifestleri önce → bağımlılık katmanı cache'lenir.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
COPY apps/voice-service/package.json apps/voice-service/
RUN pnpm install --frozen-lockfile

# Kaynak + derleme. shared ÖNCE derlenir (voice-service ona bağımlı).
COPY packages ./packages
COPY apps/voice-service ./apps/voice-service
RUN pnpm --filter @voice/shared build \
 && pnpm --filter @voice/voice-service build

# --- Runner: prod-only deps + dist ------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
COPY apps/voice-service/package.json apps/voice-service/
RUN pnpm install --frozen-lockfile --prod

# Derlenmiş çıktılar (shared exports `default` → dist/*.js bu sayede çözülür).
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/apps/voice-service/dist apps/voice-service/dist

EXPOSE 8787
# Health: WS sunucusu üstündeki GET /health (auth gerektirmez).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/health || exit 1

CMD ["node", "apps/voice-service/dist/server.js"]
