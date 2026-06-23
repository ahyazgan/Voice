# syntax=docker/dockerfile:1
# =============================================================================
# Çok-hedefli (multi-target) production imajları — api / voice-service / web.
# Build: docker build --target api -t voice-api .
#        docker build --target voice-service -t voice-vs .
#        docker build --target web -t voice-web .
#
# NOT: @voice/shared runtime'da "default"→dist ile çözülür (conditional exports);
# bu yüzden builder tüm paketleri build eder ve node dist çalışır.
# Migration uygulaması ayrı release adımıdır: `pnpm db:migrate:deploy`.
# =============================================================================

FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

# --- Ortak builder: install + prisma generate + tüm paketleri build ---
FROM base AS builder
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm db:generate && pnpm build

# --- api ---
FROM base AS api
ENV NODE_ENV=production
COPY --from=builder /repo /repo
WORKDIR /repo/apps/api
EXPOSE 4000
# /health (liveness) ve /ready (DB+Redis) uçları mevcut.
CMD ["node", "dist/server.js"]

# --- voice-service ---
FROM base AS voice-service
ENV NODE_ENV=production
COPY --from=builder /repo /repo
WORKDIR /repo/apps/voice-service
EXPOSE 8787
CMD ["node", "dist/server.js"]

# --- web (statik SPA, nginx ile) ---
FROM nginx:alpine AS web
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
