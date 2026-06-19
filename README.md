# collections-voice

Türkçe sesli tahsilat ajanı — monorepo iskeleti.
Tam mimari kararları için bkz. [ARCHITECTURE.md](ARCHITECTURE.md).

## Konumlandırma

Genel "sesli asistan" değil, **tahsilat çözümü**. Tek bir derin senaryo: borç
hatırlatma + itiraz yönetimi + ödeme sözü/tarih toplama. Fiyat sonuç bazlı,
abonelik değil. Rekabet "her şeyi yapan" jenerik ürünlere karşı bu derinlikle savunulur.

## İki Fazlı Yapı

| Faz | Mod | Ses pipeline | Bizim katkı |
|---|---|---|---|
| **Faz 1** (şimdi) | `VOICE_MODE=platform` | Retell / Vapi | state machine + LLM turları + iş mantığı + panel |
| **Faz 2** (marj gerekince) | `VOICE_MODE=cascade` | Kendi cascade'imiz (Deepgram + hızlı LLM + ElevenLabs + SIP) | tüm orkestrasyon |

Geçiş tek konfigürasyon değişikliğidir; iş mantığı (`stateMachine`, `prompts`, `db`, `panel`) hiç değişmez.

Hedef uçtan uca gecikme: **~550ms** (tavan 800ms). Bkz. [telemetry.ts](apps/voice-service/src/telemetry.ts).

## Hızlı Kurulum

Önkoşullar: Node 20+, pnpm 9, Docker.

```bash
pnpm install
cp .env.example .env

# Postgres + Redis ayağa
pnpm infra:up

# Prisma client + ilk migration
pnpm db:generate
pnpm db:migrate

# Hepsini birlikte çalıştır (turbo)
pnpm dev
```

Ayrı ayrı:

```bash
pnpm --filter @voice/voice-service dev   # ws://localhost:8787
pnpm --filter @voice/api dev             # http://localhost:4000
pnpm --filter @voice/web dev             # http://localhost:5173
```

## Paketler

| Yol | Amaç |
|---|---|
| [packages/shared](packages/shared/) | Domain tipleri, Zod şemaları, provider interface'leri (`IOrchestrationPlatform` dahil) |
| [packages/config](packages/config/) | Paylaşılan tsconfig / lint ayarları |
| [apps/voice-service](apps/voice-service/) | Faz 1 köprü + Faz 2 cascade orkestratör |
| [apps/api](apps/api/) | REST API + BullMQ arama kuyruğu |
| [apps/web](apps/web/) | İşletmenin kullandığı React panel |
| [prisma/](prisma/) | Veri modeli |

## Voice-service mimarisi

| Dosya | Sorumluluk |
|---|---|
| [turnHandler.ts](apps/voice-service/src/turnHandler.ts) | Transport-bağımsız tek tur iş mantığı. Faz 1 ve Faz 2 ortak. |
| [stateMachine.ts](apps/voice-service/src/stateMachine.ts) | XState konuşma akışı + intent → event eşlemesi |
| [prompts/index.ts](apps/voice-service/src/prompts/index.ts) | Durum bazlı sistem promptları + KVKK rıza anonsu |
| [phase1.ts](apps/voice-service/src/phase1.ts) | `IOrchestrationPlatform` üstüne `TurnHandler` köprüsü |
| [orchestrator.ts](apps/voice-service/src/orchestrator.ts) | Faz 2: STT↔LLM↔TTS cascade + **barge-in** |
| [telemetry.ts](apps/voice-service/src/telemetry.ts) | 550ms hedefi, aşama-bazlı gecikme ölçümü |

## Yeni Sağlayıcı Ekleme

1. [providers.ts](packages/shared/src/providers.ts) içindeki ilgili interface'i değiştirmeden uygula:
   - **Faz 1**: `IOrchestrationPlatform` (`retell.ts`, `vapi.ts`)
   - **Faz 2**: `ISTTProvider` / `ITTSProvider` / `ILLMProvider` / `ITelephonyProvider`
2. Implementasyonu [apps/voice-service/src/providers/](apps/voice-service/src/providers/) altına koy.
3. [providers/index.ts](apps/voice-service/src/providers/index.ts) içine env switch'i ekle.
4. `.env.example`'a yeni anahtar satırlarını ekle.

Orkestratör veya state machine'e dokunma — provider eklemek tek dosya değişimi olmalı.

## Faz 1: Retell ile gerçek arama (mock'tan çıkış)

Mock yerine gerçek arama için `ORCHESTRATION_PROVIDER=retell`. Retell aramayı +
sesi yürütür; her müşteri turunda bizim `/llm-websocket/{call_id}` adresimize
bağlanır ve state machine + LLM kararımızı seslendirir.

1. **Retell agent'ı** oluştur (panel), tipini **Custom LLM** seç.
   - `llm_websocket_url` = `wss://<voice-service-host>/llm-websocket/{call_id}`
     (yerel test: `cloudflared tunnel --url http://localhost:8787` veya ngrok ile 8787'yi aç).
   - `begin_message` **boş** bırak — rıza anonsu dinamik değişkenle gelir.
2. **`.env`** doldur:
   ```bash
   VOICE_MODE=platform
   ORCHESTRATION_PROVIDER=retell
   LLM_PROVIDER=openai            # turları gerçek LLM üretsin
   RETELL_API_KEY=...
   RETELL_AGENT_ID=...
   RETELL_FROM_NUMBER=+90...      # TR yerel giden numara (açılma oranı kritik)
   OPENAI_API_KEY=...
   ```
3. **Çalıştır:** `pnpm --filter @voice/voice-service dev`, tünelin 8787'ye işaret ettiğini doğrula.
4. **Tetikle:** API/worker üzerinden ya da control WS'e (`/control`) `{type:'start',debtor:{…}}` frame'i gönder.

> Mimari köprü: `startCall()` giden REST (aramayı başlat), turlar gelen WS'ten
> gelir; ikisi `callId` ile [retell.ts](apps/voice-service/src/providers/platform/retell.ts) içindeki
> registry üzerinden eşlenir. Protokol testleri: [retell.platform.test.ts](apps/voice-service/src/__tests__/retell.platform.test.ts).

## Geliştirme Sırası

Bkz. [ARCHITECTURE.md § 11](ARCHITECTURE.md#11-geli%C5%9Ftirme-s%C4%B1ras%C4%B1).
**1. adım kritik:** Retell/Vapi hesabıyla TR'ye giden bir test araması yap — yerel
numara/giden arama sorununu kod yazmadan önce doğrula.

## KVKK

- Tüm aramalar `CONSENT_ANNOUNCEMENT` ile başlar ([prompts](apps/voice-service/src/prompts/index.ts)).
- Ses kaydı sadece açık rıza ile saklanır (`RECORDING_RETENTION_DAYS`).
- Log'larda PII maskelenir.
