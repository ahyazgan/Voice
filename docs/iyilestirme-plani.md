# İyileştirme Planı — Türkçe Sesli Tahsilat Ajanı

Bu doküman, dört paralel derin kod denetiminin (konuşma motoru, Faz 2 cascade,
zamanlama/uyumluluk, üretim hazırlığı) sentezidir. Tüm bulgular kodla doğrulandı
(dosya:satır). Katmanlar iş etkisi + yasal risk + bağımlılık sırasına göre
dizilmiştir. Önerilen sıra: **0 → 1 → 2** (canlı aramadan ÖNCE), gerçek aramaya
geçince **3**, paralelde **4–5**.

İlerleme GitHub issue'larında takip edilir (her katman bir epic issue).

---

## Katman 0 — Ürünün ana çıktısı (PROMISE_TO_PAY güvenilmez) 🔴 ✅ TAMAM

Bunlar doğrudan "para hatası": panel/muhasebe yanlış kayıt görür.

- [x] **`confirm`'de kilitlenme + sahte ödeme sözü.** `confirm`'e
  `DISPUTES_DEBT`/`REFUSES`/`ASKS_CALLBACK` geçişleri + `refusePromise`/`clearPromise`
  ile vazgeçen müşteride söz temizleniyor (`stateMachine.ts`).
- [x] **Ödeme sözünde tutar/tarih zorunlu**: `hasAmountOrDate` guard'ı —
  ikisi de boşsa söz kilitlenmez, model detayı tekrar sorar.
- [x] **Geri arama tarihi**: context'te `callbackAt`, `recordCallback` ile yazılıp
  finalize'a taşınıyor.
- [x] **Para birimi invariantı**: stats artık her şeyi `*Kurus` döndürüyor
  (`statsMath.ts` — "Tüm para alanları KURUŞ" invariantı yorumda).
- [x] **Intent-drift testi** (`intentDrift.test.ts`): `intentsForState` ↔
  `LLMIntentSchema` ↔ `eventFromIntent` kenetini doğrular. **Bu test gerçek bir
  KVKK hatasını yakaladı:** `CONSENT_DECLINED` şemada eksikti → kayıt reddi state
  machine'e ulaşmıyordu; `LLMIntentSchema`'ya eklenerek düzeltildi.

## Katman 1 — KVKK / yasal (en yüksek hukuki risk) 🔴 ✅ TAMAM

- [x] **Rıza toplanıyor**: `CONSENT_DECLINED` intent + `declineConsent` action →
  `recordingConsent=false`; `persist.ts` rıza yoksa `recordingUrl`'i düşürür.
  (Son kopuk halka — şemadaki intent eksiği — Katman 0'da düzeltildi.)
- [x] **Retention/imha**: `runRetention` (recording+transcript TTL) periyodik sweep
  (`server.ts`), `eraseDebtorData` + `POST /debtors/:id/erase` right-to-erasure
  (doNotCall=true dahil). NOT: fiziksel storage objesi silme, storage entegrasyonu
  eklendiğinde `eraseDebtorData`'ya bağlanmalı (şu an recordingUrl null'lanıyor).
- [x] **Taciz koruması atomik**: `claimCallSlot` per-borçlu advisory lock altında
  "say + RUNNING'e geç" — processor ana yolunda çalışıyor (`processor.ts`).
- [x] **PII redaction**: pino `redact` (PII_REDACT — telefon/isim/invoiceRef/
  transcript text, iç içe dahil) hem api hem voice-service logger'ında; BullMQ
  payload zaten yalnızca ID taşıyor (`CallJobData`). Davranış testi: `piiRedact.test.ts`.

## Katman 2 — Güvenlik (üretime çıkmadan zorunlu) 🟠

- [ ] **Kontrol WS auth'u** (`voice-service/server.ts:91,156`): `/control` upgrade'inde
  paylaşılan sır/token + `msg.debtor` için zod doğrulama (yetkisiz arama başlatma /
  toll fraud açığı).
- [ ] **Gelen webhook imza doğrulaması**: Retell signature header, Telnyx Ed25519,
  Vapi secret (`voice-service/server.ts:38,78,147`).
- [ ] **Prod fail-fast**: `NODE_ENV=production` iken boş `PANEL_AUTH_SECRET`/
  `INTERNAL_API_SECRET`/`PANEL_PASSWORD` → `config.ts` parse hatası.
- [ ] **/login rate-limit** (`@fastify/rate-limit`) + **CORS allowlist**
  (`server.ts:17` `origin` → `PANEL_ORIGIN`).

## Katman 3 — Gerçek-zamanlı ses doğruluğu (Faz 2'nin canı) 🟠

- [ ] **Giden ses gerçek-zaman pacing'i** (`orchestrator.ts:178`, `telnyx.ts:119`):
  20ms μ-law (160 byte) clock-driven gönderim. Barge-in doğruluğunun ön koşulu;
  WS backpressure'ı da çözer.
- [ ] **Konuşmayı serileştir** (`orchestrator.ts:73-83,143`): tur başına
  generation-id'li tek konuşma kilidi; barge-in kararını `partial`'da körü körüne
  kesmek yerine kısa pencere/backchannel-sonrası ver (şu an backchannel filtresi
  ölü kod).
- [ ] **KPI ölçüm noktası** (`telemetry.ts:29`, `orchestrator.ts:92,137`):
  son-partial → tts_first_chunk penceresini raporla (endpointing dahil müşteri
  algısı); `llm_first_token`'ı gerçek ilk token'da işaretle.
- [ ] **Deepgram reconnect** (`deepgram.ts:124-155`): backoff reconnect + buffer
  flush + başarısızlıkta orchestrator'a hata sinyali.
- [ ] **Sağlamlık**: `sendAudio` format/encoding guard (`telnyx.ts:119`); ElevenLabs
  chunk-arası idle timeout + 429 backoff (`elevenlabs.ts:104`); Telnyx `start`
  event'iyle format doğrulaması (`telnyx.ts:178`).

## Katman 4 — Dayanıklılık & idempotency 🟡

- [ ] **finalize/followup idempotency** (`calls.ts:163-172`, `retryRunner.ts:71`):
  koşullu `updateMany(status≠COMPLETED)` + `parentCallId` unique/partial index.
- [ ] **LLM hata/timeout fallback** (`openai.ts:90`, `phase1.ts:38`,
  `turnHandler.ts:148`): `respond()`'u sar, güvenli fallback dön; iki yolu eşitle.
- [ ] **Graceful shutdown** (`server.ts:59`): sıralı kapat (worker graceful →
  app → redis/prisma disconnect); finalize kaybına karşı "stuck call reaper".
- [ ] **Deterministik jobId** (`queue/index.ts:24`): `${callId}:${attempt}` ile
  çift job'u BullMQ seviyesinde engelle; `removeCampaignJobs` tip listesini
  düzelt (`'wait'`→`'waiting'`).

## Katman 5 — Üretim altyapısı 🟡

- [ ] **Deploy pipeline**: her servis için multi-stage Dockerfile; `migrate deploy`
  script'i; CI'a `pnpm build`; `@voice/shared` exports'u `dist`'e yönlendir
  (module resolution tutarlılığı).
- [ ] **Health/readiness**: voice-service'e HTTP `/health`; her iki serviste
  DB+Redis ping'leyen `/ready`.
- [ ] **Eksik indeksler** (`schema.prisma`): `Debtor.phoneE164` (unique/normalize —
  taciz limitini telefona da bağla), `Call @@index([status,scheduledFor])`,
  `@@index([debtorId,outcome])`, `@@index([parentCallId])`.
- [ ] **Entegrasyon testleri**: Fastify `inject` ile finalize transaction / auth
  guard / campaign state geçişleri / `scheduleCall` / `retryRunner`; web'e temel
  test; CI'da coverage eşiği.
- [ ] **Gözlemlenebilirlik**: `/metrics` (Prometheus); prod'da cost rate'leri
  zorunlu kıl (default 0 → yanlış maliyet raporu); error tracking.
- [ ] **DX**: `lint` task'ını gerçekten kur ya da ölü task'ı kaldır
  (`packages/config` eslint config eksik, `pnpm lint` no-op).

---

## Notlar
- Faz 1 (platform/Retell) için Katman 3 geçerli değil (sesi platform yürütür);
  Katman 0–2 ve 4–5 her iki fazda da geçerli.
- "En yüksek etkili ilk batch" = Katman 0: sınırlı, test edilebilir, ürünün
  canını korur. Buradan başlanır.
