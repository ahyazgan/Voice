# Deployment

Production paketleme ve çalıştırma notları. (Imajlar bu repodaki çok-hedefli
`Dockerfile` ile üretilir; CI imaj build etmez — gerçek `docker build` ile
doğrulanmalıdır.)

## İmajlar

```bash
docker build --target api           -t voice-api:latest .
docker build --target voice-service -t voice-vs:latest .
docker build --target web           -t voice-web:latest .
```

- **api** (`:4000`) — REST + BullMQ worker + retention/reaper sweep'leri.
  Sağlık: `/health` (liveness), `/ready` (Postgres + Redis).
  Gözlemlenebilirlik: `/metrics` (Prometheus — arama durum/sonuç sayıları +
  kuyruk derinliği; `/api` dışı, ağ politikasıyla internal-only tutulmalı).
- **voice-service** (`:8787`) — Faz 1 köprü / Faz 2 cascade WS. Sağlık: `GET /health`.
- **web** — statik SPA, nginx ile servis edilir (`:80`).

> `@voice/shared` runtime'da `dist`'ten çözülür (conditional exports); builder
> tüm paketleri build ettiği için `node dist/server.js` çalışır.

## Migration (release adımı)

App container'ları migration ÇALIŞTIRMAZ. Deploy akışında, yeni sürümü
yaymadan önce ayrı bir release adımında uygula:

```bash
DATABASE_URL=... pnpm db:migrate:deploy
```

## Zorunlu env (production fail-fast)

`NODE_ENV=production` iken şu sırlar BOŞSA api başlatmada hata verir
(yanlış deploy'da korumasız kalmasın):

- `PANEL_PASSWORD`, `PANEL_AUTH_SECRET`, `INTERNAL_API_SECRET`

Ek olarak prod'da ayarla: `DATABASE_URL`, `REDIS_URL`, `VOICE_WS_URL`,
`PANEL_ORIGIN` (CORS), `INBOUND_WS_TOKEN` / `VAPI_SERVER_SECRET` (gelen uç auth),
sağlayıcı anahtarları (Retell/OpenAI vb. — bkz. `.env.example`).

## Çalıştırma sırası

1. `pnpm db:migrate:deploy` (release).
2. `voice-service` ayağa kalkar (tünel/numara provider URL'leri `INBOUND_WS_TOKEN`
   içermeli — bkz. `docs/faz1-arama-testi.md`).
3. `api` ayağa kalkar (worker voice-service `/control`'e `INTERNAL_API_SECRET` ile bağlanır).
4. `web` (nginx) panel'i servis eder; reverse-proxy `/api` → api.

## İyileştirme notu

Mevcut imajlar builder çıktısını bütün olarak kopyalar (devDeps dahil — daha
büyük). İleride `pnpm deploy --prod` ya da prune ile küçültülebilir; öncelik
doğru çalışan `node dist` idi.
