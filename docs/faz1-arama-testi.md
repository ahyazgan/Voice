# Faz 1 — Gerçek TR Arama Testi (Hazırlık Checklist'i)

> Yol haritası **adım 1** (ARCHITECTURE.md § 11) ve en kritik blokör: kod yazmadan
> önce platformun (Retell) TR'ye gerçek bir giden arama yapabildiğini doğrula.
> Buradaki amaç **kodu test etmek değil**, telefon hattı / yerel numara / giden
> arama izinlerini doğrulamak. Sorun çıkarsa neredeyse her zaman hesap/numara
> tarafındadır, kod tarafında değil.

Bu doküman koda dayalıdır; geçişler ve env adları gerçek kaynaktan alınmıştır.

---

## 0. Önkoşullar (hesap & yerel)

- [ ] **Retell** hesabı + API anahtarı.
- [ ] **TR yerel giden numara** Retell'e tanımlı (açılma oranı için kritik —
      yurtdışı numara TR'de çoğu kez reddedilir/spam'e düşer).
- [ ] **OpenAI** API anahtarı (turları gerçek LLM üretsin; `gpt-4o-mini`).
- [ ] Aranacak **kendi test telefonun** (gerçek cevap verip akışı dinlemek için).
- [ ] Yerel: Node 20+, pnpm 9, Docker; `cloudflared` **veya** `ngrok` (tünel).

---

## 1. `.env` doldur

`cp .env.example .env` sonrası **en az** şunlar:

```bash
# --- Mod & sağlayıcı seçimi (Faz 1) ---
VOICE_MODE=platform
ORCHESTRATION_PROVIDER=retell
LLM_PROVIDER=openai
# STT/TTS/TELEPHONY mock kalır — platform modunda sesi RETELL yürütür,
# Deepgram/ElevenLabs/Telnyx KULLANILMAZ (onlar Faz 2 cascade içindir).

# --- Retell ---
RETELL_API_KEY=...
RETELL_AGENT_ID=...            # adım 2'de oluşturacağın agent
RETELL_FROM_NUMBER=+90...      # TR yerel giden numara (E.164)

# --- OpenAI ---
OPENAI_API_KEY=...
# OPENAI_MODEL / OPENAI_TEMPERATURE varsayılanları iyi (gpt-4o-mini / 0.55)

# --- Ajan kimliği (prompt + KVKK rıza anonsunda geçer) ---
AGENT_NAME=Zeynep
COMPANY_NAME=<işletme adı>

# --- voice-service → API finalize köprüsü ---
API_BASE_URL=http://localhost:4000      # boşsa sonuç DB'ye yazılmaz (persist atlanır)
INTERNAL_API_SECRET=<rastgele-uzun-sır>  # API tarafıyla AYNI olmalı

# --- API / worker ---
DATABASE_URL=postgresql://...            # infra:up sonrası local Postgres
REDIS_URL=redis://localhost:6379
VOICE_WS_URL=ws://localhost:8787         # API worker → voice-service /control
# INTERNAL_API_SECRET (yukarıdakiyle birebir aynı değer)

# --- Panel (opsiyonel ama önerilir; aramayı panelden tetiklemek için) ---
PANEL_PASSWORD=<parola>
PANEL_AUTH_SECRET=<rastgele-uzun-sır>
```

> ⚠️ **`INTERNAL_API_SECRET` iki tarafta da aynı olmalı** — voice-service finalize
> özetini `x-internal-secret` ile API'ye POST eder; uyuşmazsa API 401 döner ve
> sonuç DB'ye yazılmaz (arama yine de çalışır, ama panelde görünmez).

---

## 2. Retell agent'ı oluştur (panel)

- [ ] Yeni agent, tip **Custom LLM**.
- [ ] `llm_websocket_url` = `wss://<tünel-host>/llm-websocket/{call_id}`
      (tünel host'unu adım 4'te alacaksın; sonra buraya yapıştır).
- [ ] `begin_message` **boş** bırak — açılış (KVKK rıza anonsu) bizden dinamik gelir.
- [ ] **Türkçe ses seç** (yol haritası adım 2). Faz 1'de ses Retell agent'ında
      seçilir, ELEVENLABS_VOICE_ID **değil**. Telefon kalitesinde (8kHz) 2–3
      Türkçe sesi yan yana dinleyip en doğalı seç.
- [ ] Agent ID'yi `.env`'deki `RETELL_AGENT_ID`'ye yaz.

---

## 3. Altyapı + servisler

```bash
pnpm install
pnpm infra:up         # Postgres + Redis (docker)
pnpm db:generate
pnpm db:migrate

# 3 servis (ayrı terminal):
pnpm --filter @voice/voice-service dev   # ws://localhost:8787
pnpm --filter @voice/api dev             # http://localhost:4000
pnpm --filter @voice/web dev             # http://localhost:5173 (panel)
```

Beklenen voice-service log'u: `platform ws listening` · `paths: ['/control', '/llm-websocket/:callId']`.

---

## 4. Tüneli aç (Retell → voice-service ulaşsın)

Retell, buluttan senin makinene WSS ile bağlanır; 8787'yi public yap:

```bash
cloudflared tunnel --url http://localhost:8787
#   → https://<rastgele>.trycloudflare.com verir
# ngrok alternatifi:  ngrok http 8787
```

- [ ] Çıkan host'la Retell agent `llm_websocket_url`'ini güncelle:
      `wss://<host>/llm-websocket/{call_id}` (https → wss).
- [ ] `{call_id}` literaldir; Retell bağlanırken yola kendi call_id'sini koyar
      ([retell.ts](../apps/voice-service/src/providers/platform/retell.ts) registry
      eşlemesini buna göre yapar).

---

## 5. Aramayı tetikle

**Arama penceresine dikkat** ([config.ts](../apps/api/src/config.ts)): varsayılan
`CALL_WINDOW_START=08:00`, `CALL_WINDOW_END=19:00`, günler Pzt–Cmt
(`Europe/Istanbul`). Pencere dışındaysan worker aramayı **erteler** (SCHEDULED),
hemen aramaz. Test bunun dışındaysa env'le pencereyi geçici genişlet.

### Yol A — Panel (önerilen, uçtan uca)
1. Panel'e gir (`PANEL_PASSWORD`).
2. **Borçlular → Yükle**: tek satırlık CSV (`fullName,phoneE164,amountDue,dueDate`),
   `phoneE164` = **kendi test numaran** (`+90...`).
3. Borçluyu seç → **kampanya başlat**. Worker job'ı kuyruğa alır → voice-service
   `/control`'e start frame gönderir → Retell `create-phone-call` → telefonun çalar.

### Yol B — Doğrudan control WS (kod/panel olmadan hızlı test)
`ws://localhost:8787/control` adresine tek frame:
```json
{ "type": "start", "debtor": { "id": "t1", "fullName": "Test", "phoneE164": "+90...", "amountDue": 50000, "currency": "TRY", "dueDate": "2026-07-01T00:00:00Z" } }
```
(websocat / wscat ile gönderilebilir.)

---

## 6. Başarı kriteri & ne gözlemlenecek

voice-service log'unda sırayla:
- [ ] `retell create-phone-call` başarılı (call_id döndü).
- [ ] Telefon **çaldı** ve açınca **KVKK rıza anonsu** Türkçe duyuldu.
- [ ] Her konuşma turunda `/llm-websocket` üzerinden tur geldi, LLM yanıt verdi.
- [ ] Arama bitince **finalize** API'ye POST edildi (panelde **Aramalar**'da
      sonuç/transkript/maliyet göründü).

**Esas doğrulanan:** numara çaldı + ses karşıya gitti. Bu olduysa adım 1 geçti;
geri kalanı (doğallık, senaryo) iteratif iyileştirme.

---

## 7. Sık çıkan sorunlar

| Belirti | Olası neden |
|---|---|
| `create-phone-call` 4xx | `RETELL_API_KEY` / `RETELL_AGENT_ID` yanlış; numara Retell'e tanımlı değil |
| Telefon hiç çalmıyor | `RETELL_FROM_NUMBER` TR yerel değil / giden arama kapalı; aranan numara formatı E.164 değil |
| Açılınca sessizlik / WS bağlanmıyor | Tünel host'u agent URL'iyle uyuşmuyor; `https` yerine `wss` kullan; 8787 ayakta değil |
| Açılma oranı düşük | Yurtdışı numara — TR yerel numaraya geç |
| Arama oluyor ama panelde sonuç yok | `INTERNAL_API_SECRET` iki tarafta farklı (finalize 401) veya `API_BASE_URL` boş |
| Worker arıyor ama "SCHEDULED" | Arama penceresi dışındasın (`CALL_WINDOW_*`) |
| İngilizce/robotik ses | Faz 1'de ses **Retell agent'ında** seçilir; Türkçe-native bir ses ata |

---

## Sonraki adım

Bu test geçince → yol haritası **adım 2** (Türkçe ses A/B seçimi, telefon
kalitesinde) ve **adım 3+** (senaryo derinleştirme). Faz 2 cascade'e ancak marj
gerektiğinde geçilir — `VOICE_MODE=cascade`, iş mantığı değişmez.
