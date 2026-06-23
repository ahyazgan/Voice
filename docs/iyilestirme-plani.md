# İyileştirme Planı — Türkçe Sesli Tahsilat Ajanı

Bu doküman, dört paralel derin kod denetiminin (konuşma motoru, Faz 2 cascade,
zamanlama/uyumluluk, üretim hazırlığı) sentezidir. Tüm bulgular kodla doğrulandı
(dosya:satır). Katmanlar iş etkisi + yasal risk + bağımlılık sırasına göre
dizilmiştir. Önerilen sıra: **0 → 1 → 2** (canlı aramadan ÖNCE), gerçek aramaya
geçince **3**, paralelde **4–5**.

İlerleme GitHub issue'larında takip edilir (her katman bir epic issue).

---

## Katman 0 — Ürünün ana çıktısı (PROMISE_TO_PAY güvenilmez) 🔴

Bunlar doğrudan "para hatası": panel/muhasebe yanlış kayıt görür.

- [ ] **`confirm`'de kilitlenme + sahte ödeme sözü.** Müşteri teyitte itiraz/ret
  ederse geçerli intent yok (`stateMachine.ts:161-168`); `NO_RESPONSE`'a düşüp
  takılır ve outcome zaten `PROMISE_TO_PAY` set edilmiştir → gerçekte söz olmadan
  kayıt. → `confirm`'e `DISPUTES_DEBT`/`REFUSES`/`ASKS_CALLBACK` geçişleri + prompt
  intent listesini senkronla.
- [ ] **Ödeme sözünde tutar/tarih zorunlu değil** (`stateMachine.ts:121,192`):
  boş `promisedAmount/Date` ile `PROMISE_TO_PAY` yazılabiliyor. → `WILL_PAY`/
  `PARTIAL_OR_PLAN` için `hasAmountOrDate` guard'ı; eksikse re-ask alt-akışı.
- [ ] **Geri arama tarihi kayboluyor** (`stateMachine.ts:262-266`): context'e
  `callbackAt` ekle, action ile yaz, finalize payload'una taşı.
- [ ] **Para birimi 100x sapma riski** (`statsMath.ts:36/78`): stats kuruşu
  `totalTRY` adıyla döndürüyor. → Tek invariant: her şey `*Kurus`; alan adlarını
  düzelt, şema yorumuna birim invariantı yaz.
- [ ] **Intent-drift testi**: `intentsForState` enum'u ile `stateMachine.on`
  anahtarlarının eşitliğini doğrulayan test (drift sessizce kaçıyor).

## Katman 1 — KVKK / yasal (en yüksek hukuki risk) 🔴

- [ ] **Rıza gerçekte toplanmıyor** (`prompts/index.ts:156`): anons sadece
  duyuru; "hayır" cevabını yakalayan intent/state yok, `consentToRecord` dışarıdan
  geliyor. → opt-out intent'i + reddi `consentToRecord=false`'a bağla; persist'i
  buna göre kısıtla (`persist.ts:33`).
- [ ] **Retention/imha job'u yok**: `recordingUrl`+transkript süresiz duruyor;
  `doNotCall`/silme talebi mevcut kayıtları silmiyor. → saklama-süresi env'i +
  periyodik retention worker (recording+transcript+result) + right-to-erasure akışı
  (storage objesi dahil).
- [ ] **Taciz koruması atomik değil (TOCTOU)** (`harassmentGuard.ts:43-74` +
  `processor.ts:46-60`): eşzamanlı job'lar limiti dolmamış görüp aynı borçluyu
  birden çok arayabilir. → advisory-lock / koşullu `updateMany(QUEUED→RUNNING)` ile
  "say + RUNNING'e geç"i atomikleştir; worker ana yolunda da taciz kapısını çalıştır.
- [ ] **PII redaction**: pino `redact` (`*.phoneE164`,`*.fullName`,`*.text`);
  başarısız BullMQ job payload'undan PII'yi çıkar (sadece `debtorId` taşı,
  `queue/index.ts`). LLM/STT/TTS'e PII aktarımının dayanağını dokümante et.

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
