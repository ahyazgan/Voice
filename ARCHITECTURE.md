# Türkçe Sesli Tahsilat Ajanı — Mimari & Geliştirme Rehberi

> Bu doküman, Cursor / Claude Code için referans spesifikasyondur.
> Kod yazarken bu mimari kararlara ve kısıtlara uy. Sapacaksan önce gerekçesini yaz.
> v2 — 2026 sektör bulguları + rakip analizi + Faz 1/Faz 2 ayrımı eklendi.

---

## 1. Ne İnşa Ediyoruz?

İşletmelerin geciken alacaklarını otomatik olarak arayan, müşteriyle doğal Türkçe
konuşan, ödeme sözü/tarih toplayan ve sonucu işletmeye raporlayan bir sesli AI sistemi.

Bir arama döngüsü:
telefon → müşterinin sesi (canlı akış) → STT → LLM (durum makinesi kontrolünde)
→ TTS (Türkçe) → telefona geri ses. Müşteri kapatana kadar tekrarlar.

İnşa ettiğimiz çekirdek: STT/LLM/TTS/telefon arasındaki **gerçek zamanlı orkestratör**.
Bu dört bileşenin kendisi dış servistir (adapter ardına soyutlanır).

### Konumlandırma (rakip analizinden)

Türkiye'de GENEL sesli asistan pazarı dolmaya başladı (AI Agent TR, Sesla, AI Calls,
ThinkVoice vb. — hepsi "her şeyi yapan asistan": randevu + destek + soğuk arama).
Bu yüzden kazanma stratejisi: **dar ama derin** — "sesli asistan" değil, **TAHSİLAT ÇÖZÜMÜ**.
Genel asistanların yapmadığı: itiraz yönetimi, ödeme planı pazarlığı, yasal arama
sınırları, borçlu psikolojisi, ödeme sözü takibi. Bu derinlik savunma hattımız.
Fiyat modeli de ayrışır: abonelik DEĞİL, sonuç bazlı (tahsil edilen %'si / ödeme sözü başına).

### Sektör gerçeği (2026)

- Gecikme (latency) artık çözülmüş bir problem; en iyiler ~550ms'de. ASIL darboğaz
  teknik değil, işletmeyi kullanmaya İKNA etmek (= satış/dağıtım). TR'de o boşluk açık.
- En iyi platformların hepsi "provider slot" mimarisi kullanıyor (bizim adapter pattern'imiz doğru).
- Cascade (STT→LLM→TTS) Türkçe için doğru tercih: en iyi TR STT + en doğal TR TTS ayrı seçilir.
  Speech-to-speech tek-model yaklaşımı düşük gecikme verir ama Türkçe'de zayıf + lock-in.

---

## 2. Mimari İlkeler (Pazarlık edilemez)

1. **Monorepo, servis ayrımı.** Ses servisi panel API'sinden ayrı bir process.
2. **TypeScript baştan sona.** Tüm domain tipleri `packages/shared` içinde.
3. **Streaming-first.** Hiçbir yerde "tüm sesi bekle sonra işle" yok. Her şey akar.
4. **Açık durum makinesi.** LLM serbest değil; XState durumları aksiyonları kısıtlar.
5. **Provider soyutlama.** STT/TTS/Telephony/LLM hepsi interface ardında, değiştirilebilir.
6. **Barge-in pazarlık edilemez.** Müşteri AI'ı keserse AI ANINDA susar. Üretim şartı.
7. **Gecikme = KPI.** Hedef ~550ms, tavan ~800ms (uçtan uca: müşteri sustuktan AI ilk sese).
8. **Gözlemlenebilirlik baştan.** Yapılandırılmış log + aşama-bazlı gecikme metrikleri.
9. **KVKK uyumu kod seviyesinde.** Kayıt rızası, saklama süresi, veri minimizasyonu.

---

## 3. Repo Yapısı

```
collections-voice/
├── apps/
│   ├── voice-service/        # Gerçek zamanlı ses orkestratörü (kendi process'i)
│   │   ├── src/
│   │   │   ├── server.ts           # WebSocket sunucu (telefon API bağlanır)
│   │   │   ├── orchestrator.ts      # STT↔LLM↔TTS streaming köprüsü
│   │   │   ├── stateMachine.ts      # XState konuşma akışı
│   │   │   ├── providers/
│   │   │   │   ├── telephony/       # ITelephonyProvider implementasyonları
│   │   │   │   ├── stt/             # ISTTProvider
│   │   │   │   ├── tts/             # ITTSProvider
│   │   │   │   └── llm/             # ILLMProvider
│   │   │   ├── prompts/             # Sistem promptları, durum bazlı talimatlar
│   │   │   └── telemetry.ts         # Gecikme ölçümü + log
│   │   └── package.json
│   ├── api/                  # REST API + panel backend (Fastify/NestJS)
│   │   └── src/
│   │       ├── routes/             # debtors, campaigns, calls, auth
│   │       ├── queue/              # BullMQ arama kuyruğu üreticisi
│   │       └── db/                 # Prisma client
│   └── web/                  # React panel (işletmenin kullandığı arayüz)
├── packages/
│   ├── shared/               # Ortak tipler, enum'lar, Zod şemaları
│   │   └── src/types.ts
│   └── config/               # Paylaşılan tsconfig, eslint
├── prisma/
│   └── schema.prisma
├── docker-compose.yml        # Postgres + Redis (yerel geliştirme)
└── turbo.json
```

---

## 4. Teknoloji Yığını

| Katman | Seçim | Gerekçe |
|---|---|---|
| Dil | TypeScript | Tek dil, paylaşılan tipler |
| Monorepo | pnpm + Turborepo | Hızlı, standart |
| Ses servisi | Node.js + `ws` (WebSocket) | Düşük gecikmeli akış |
| Durum makinesi | XState | Denetlenebilir, görselleştirilebilir konuşma akışı |
| API | Fastify (veya NestJS) | Hızlı; NestJS yapı ister |
| Kuyruk | BullMQ + Redis | Arama kuyruğu, tekrar deneme, hız limiti |
| DB | PostgreSQL + Prisma | İlişkisel veri + tip güvenli sorgu |
| Panel | React + Vite + TanStack Query | Standart, hızlı |
| Validasyon | Zod | Runtime + tip; shared'da şemalar |
| Log/Metrik | pino + OpenTelemetry | Yapılandırılmış log, gecikme izleme |

---

## 4.5. İki Fazlı Yapı (KRİTİK KARAR)

Sektörün "çözülmüş" dediği zor kısımları (gerçek zamanlı ses akışı, barge-in,
turn-taking, gecikme optimizasyonu) Faz 1'de PLATFORMA devret. Kendi değerimizi
(tahsilat zekası + Türkçe senaryo + Türkiye dağıtımı) üstüne koy. Marj gerekince
Faz 2'de kendi cascade stack'ine geç. Adapter pattern bu geçişi kodu kırmadan sağlar.

### Faz 1 — Orkestrasyon Platformu Üstüne (ŞİMDİ başla)

Telefon + STT + LLM + TTS akışını platforma bırak. `voice-service` İNCE kalır:
durum makinesi + tahsilat iş mantığı + yapılandırılmış çıktı SENDE.

| Aday | Ne için iyi | Not |
|---|---|---|
| **Retell AI** | Kutudan kalite, tek kişi/küçük ekip için en hızlı sonuç | Pipeline'ı kendi optimize eder, telephony-native |
| **Vapi** | Maksimum kontrol, provider-agnostik (14+ sağlayıcı slot) | Daha çok mühendislik gerektirir, BYOK |

> Öneri: Retell ile başla (hıza öncelik). `ITelephonyProvider`+orkestrasyon
> bu platforma map'lenir. Türkçe TTS olarak ElevenLabs (Flash) seç.
> Referans en-iyi konfig: Deepgram (STT) + hızlı/küçük LLM + ElevenLabs Flash (TTS) ≈ 550ms.
> NOT: "En büyük LLM" değil, "en HIZLI LLM" — gecikmede her ms doğallığı belirler.

### Faz 2 — Kendi Cascade Stack'i (marj gerekince geç)

Dakika başı maliyeti düşürmek için orkestratörü KENDİN yaz (`orchestrator.ts`).
Bileşenler doğrudan: Deepgram/STT + hızlı LLM + ElevenLabs/TTS + Telnyx/SIP.
Bölüm 7'deki streaming mantığı tam bu fazda devreye girer.

> Provider soyutlaması sayesinde Faz 1→2 geçişi = orkestrasyon adapter'ını değiştirmek.
> İş mantığı (stateMachine, prompts, db, panel) hiç değişmez.

---

## 4.6. Teknoloji Yığını Detayı (devam)

---

## 5. Çekirdek Domain Tipleri (`packages/shared/src/types.ts`)

```typescript
export type CallOutcome =
  | 'PROMISE_TO_PAY'      // ödeme sözü alındı
  | 'DISPUTE'            // müşteri borca itiraz etti
  | 'WRONG_NUMBER'
  | 'NO_ANSWER'
  | 'CALLBACK_REQUESTED'
  | 'ESCALATED_TO_HUMAN'
  | 'REFUSED';

export interface Debtor {
  id: string;
  fullName: string;
  phoneE164: string;        // +90...
  amountDue: number;        // kuruş cinsinden (float kullanma)
  currency: 'TRY';
  dueDate: string;          // ISO
  invoiceRef?: string;
}

export interface CallResult {
  callId: string;
  debtorId: string;
  outcome: CallOutcome;
  promisedAmount?: number;
  promisedDate?: string;    // ISO
  transcript: TranscriptTurn[];
  recordingUrl?: string;    // KVKK: rıza varsa
  durationSec: number;
  costBreakdown: CostBreakdown;
  startedAt: string;
}

export interface CostBreakdown {
  telephonySec: number;
  sttSec: number;
  llmTokensIn: number;
  llmTokensOut: number;
  ttsChars: number;
  totalTRY: number;
}

export type ConversationState =
  | 'greeting' | 'identify' | 'remind' | 'negotiate'
  | 'confirm' | 'escalate' | 'closing';
```

---

## 6. Provider Soyutlama (örnek interface)

```typescript
export interface ITTSProvider {
  /** Metni Türkçe sese çevirir, ses parçalarını AKIŞ olarak verir. */
  synthesizeStream(text: string, opts: TTSOptions): AsyncIterable<AudioChunk>;
  readonly name: string;
}

export interface ISTTProvider {
  /** Canlı ses akışından parça parça transkript üretir. */
  createSession(opts: STTOptions): STTSession; // emit: 'partial' | 'final'
  readonly name: string;
}
```

Her sağlayıcının somut implementasyonu `providers/` altında. `config`ten
hangi sağlayıcının aktif olduğu seçilir. Türkçe TTS için en az 2-3 sağlayıcı
implemente et ve gerçek telefon hattında (8kHz, sıkıştırılmış) yan yana dinle.

---

## 7. Orkestratör — Streaming Mantığı (sözde-kod)

```
ws.on('audio_chunk', chunk => sttSession.push(chunk))

sttSession.on('partial', text => {
   // barge-in: AI konuşurken müşteri konuşmaya başladıysa TTS'i DURDUR
   if (ttsIsPlaying) ttsPlayback.stop()
})

sttSession.on('final', async userText => {
   const state = machine.currentState
   const llmStream = llm.stream({
      system: prompts.forState(state),
      context: { debtor, state, history },
      userText
   })
   // LLM token üretirken, cümle sınırında parça parça TTS'e yolla
   for await (const sentence of sentenceChunks(llmStream)) {
      for await (const audio of tts.synthesizeStream(sentence)) {
         ws.send(audio)            // telefona geri akıt
      }
   }
   machine.send(deriveEvent(llmStructuredOutput)) // durum geçişi
})
```

Hedef gecikme: müşteri sustuktan AI ilk sesi çıkarana kadar **~550ms (tavan ~800ms)**.
`telemetry.ts` her aşamayı (STT-final, LLM-ilk-token, TTS-ilk-chunk) ayrı ayrı ölçsün ki
darboğazın hangi bileşende olduğunu bilelim. NOT: barge-in (yukarıdaki TTS.stop) her
üretim ajanında ZORUNLU — müşteri kestiğinde 1-2 ses paketi içinde susmalı.

---

## 8. Durum Makinesi (XState taslağı)

```
greeting   --tanındı-->            identify
identify   --kimlik doğru-->       remind
identify   --yanlış kişi-->        closing (outcome: WRONG_NUMBER)
remind     --ödeyeceğim-->         confirm
remind     --itiraz-->             escalate (outcome: DISPUTE)
negotiate  --tarih verdi-->        confirm
confirm    --teyit-->              closing (outcome: PROMISE_TO_PAY)
*          --müşteri kızdı/karışık--> escalate (outcome: ESCALATED_TO_HUMAN)
```

Her durumun kendi prompt talimatı var (`prompts/forState`). LLM çıktısı
**yapılandırılmış** olmalı (intent + extracted fields) ki durum geçişi
metinden tahminle değil, alandan tetiklensin.

---

## 9. KVKK / Uyum (kod seviyesinde)

- Arama başında kayıt rızası anonsu (TTS ile sabit metin) — atlanamaz.
- `recordingUrl` yalnızca rıza alındıysa doldurulur.
- Saklama süresi: ham ses kaydı için yapılandırılabilir TTL (örn. 90 gün), sonra otomatik sil.
- Transkriptte gereksiz kişisel veri tutma (veri minimizasyonu).
- Aramaların log'unda PII maskeleme.

---

## 10. Türkiye'ye Özgü Riskler (önce çöz)

1. **Giden arama hattı.** Yurtdışı telefon API'leri TR'de yerel numara/giden
   arama konusunda kısıtlı olabilir. Yerel SIP/operatör entegrasyonunu Hafta 1'de doğrula.
   `ITelephonyProvider` ardına al ki sağlayıcı değişimi kodu kırmasın.
2. **Türkçe TTS doğallığı.** Ürünün farklılaştırıcısı. Telefon kalitesinde test et.
3. **Gecikme.** TR sunucu konumu (veri merkezi) gecikmeyi etkiler; provider'lara
   yakın bölge seç.

---

## 11. Geliştirme Sırası (her adım tek başına test edilir)

> Faz 1 yaklaşımı: ses akışını platform (Retell/Vapi) hallediyor. Sen iş mantığına odaklan.

1. **Platform + TR hattı.** Retell/Vapi hesabı, bir test numarasıyla platformun sabit
   senaryoyla arama yapmasını sağla. TR giden arama / yerel numara sorununu BURADA doğrula.
2. **Türkçe ses seçimi.** 2-3 TR TTS sesini gerçek telefon hattında (8kHz) yan yana dinle, en doğalı seç.
3. **Tahsilat senaryosu (statik).** Tek bir borçlu için sabit konuşma akışı çalışsın.
4. **Durum makinesi + yapılandırılmış çıktı.** XState akışı, itiraz/ödeme-sözü yönetimi,
   LLM'den intent+alan çıkarımı (serbest metin değil).
5. **Kuyruk + DB.** Liste yükle (CSV), BullMQ ile sırayla ara, sonucu Postgres'e yaz.
6. **Panel.** İşletmenin liste yükleyip sonuç gördüğü React arayüzü.
7. **Telemetri + maliyet + KVKK anonsu.** Aşama gecikmeleri, dakika maliyeti, rıza anonsu.
8. **(Faz 2, sonra)** Marj gerekince `orchestrator.ts`'i kendin yaz, kendi cascade'e geç.

> Her adımı birleştirmeden önce izole çalıştır. Hata noktasını ancak böyle bulursun.

---

## 12. Cursor / Claude Code İçin Çalışma Notları

- Yeni özelliğe başlamadan önce ilgili `packages/shared` tipini güncelle.
- Provider eklerken yalnızca interface'i implemente et; orkestratörü değiştirme.
- Gerçek zamanlı kod (orchestrator, stateMachine) için her PR'da gecikme metriği ekle.
- "Serbest" LLM cevabı yazma; her zaman durum + yapılandırılmış çıktı bağla.
- Sırların (.env) repoda olmadığından emin ol; `.env.example` tut.
