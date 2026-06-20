import { z } from 'zod';

const EnvSchema = z.object({
  API_PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  LOG_LEVEL: z.string().default('info'),

  // Worker → voice-service kontrol WS adresi
  VOICE_WS_URL: z.string().default('ws://localhost:8787'),
  // Bir aramanın azami süresi (ms). Aşılırsa worker WS'i kapatır, job fail eder.
  CALL_TIMEOUT_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
  // Eşzamanlı arama sayısı (BullMQ worker concurrency)
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),

  // voice-service → API arası paylaşılan sır. finalize gibi servis-içi
  // endpoint'leri korur. Boşsa korumalı route'lar kapalı kalır (yalnızca yerel
  // geliştirme için kabul edilebilir; production'da MUTLAKA ayarla).
  INTERNAL_API_SECRET: z.string().optional(),

  // Worker → voice-service `/control` WS auth sırrı. voice-service tarafındaki
  // CONTROL_AUTH_SECRET ile aynı olmalı; boşsa INTERNAL_API_SECRET'a düşer
  // (voice-service de aynı fallback'i uygular).
  CONTROL_AUTH_SECRET: z.string().optional(),

  // Panel girişi (insan operatör). Tek paylaşılan parola + HMAC bearer token.
  // İkisi de boşsa panel auth KAPALI (yalnızca yerel geliştirme).
  // PANEL_PASSWORD: operatörün gireceği parola. PANEL_AUTH_SECRET: token imza anahtarı.
  PANEL_PASSWORD: z.string().optional(),
  PANEL_AUTH_SECRET: z.string().optional(),
  // Token geçerlilik süresi (saat).
  PANEL_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(12),

  // KVKK: ses kaydı rızası politikası. Varsayılan GÜVENLİ (false = kayıt yok).
  // İşletme kayıt saklamak istiyorsa ve hukuki dayanağı varsa true yapar.
  // Anons her durumda çalınır; bu yalnızca kaydın SAKLANIP saklanmayacağını belirler.
  DEFAULT_RECORDING_CONSENT: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // KVKK saklama süresi: ses kaydı bu kadar GÜN sonra otomatik silinir (recordingUrl
  // null'lanır + storage'dan silme hook'u çağrılır). 0 = TTL kapalı (silme yok).
  RECORDING_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(90),
  // Saklama taraması kaç saatte bir çalışsın (0 = kapalı).
  RECORDING_SWEEP_HOURS: z.coerce.number().nonnegative().default(24),

  // --- Kayıt deposu (S3-uyumlu). TTL taraması süresi dolanı buradan da siler. ---
  // 'none' = depo yok (Faz 1'de kayıt platformda; o zaman silme platform API'siyle
  // yapılmalı — burada sadece DB temizlenir). 's3' = S3/MinIO/R2/GCS-S3.
  RECORDING_STORE: z.enum(['none', 's3']).default('none'),
  RECORDING_S3_ENDPOINT: z.string().optional(),
  RECORDING_S3_BUCKET: z.string().optional(),
  RECORDING_S3_REGION: z.string().default('us-east-1'),
  RECORDING_S3_ACCESS_KEY_ID: z.string().optional(),
  RECORDING_S3_SECRET_ACCESS_KEY: z.string().optional(),
  RECORDING_S3_PUBLIC_BASE_URL: z.string().optional(),

  // --- Arama saati penceresi (TR yasal — hukukçuya doğrulat) ---
  // Pencere dışı aramalar DÜŞÜRÜLMEZ, bir sonraki açık pencereye ZAMANLANIR.
  // Saatler borçlunun timezone'unda değerlendirilir. HH:MM (24s).
  CALL_WINDOW_START: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default('08:00'),
  CALL_WINDOW_END: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default('19:00'),
  // İzinli günler: 1=Pzt … 7=Paz (ISO). Varsayılan Pzt–Cmt (Pazar yasak varsayımı).
  CALL_WINDOW_DAYS: z.string().default('1,2,3,4,5,6'),
  // Borçluda timezone boşsa kullanılacak varsayılan.
  CALL_DEFAULT_TIMEZONE: z.string().default('Europe/Istanbul'),
  // Resmi/dini tatiller: virgülle ayrık YYYY-MM-DD listesi (bu günlerde arama yok).
  // Dini bayramlar her yıl kaydığı için statik liste; yıllık güncellenir.
  PUBLIC_HOLIDAYS: z.string().default(''),

  // --- KVKK taciz sınırı (hukukçuya doğrulat — muhafazakâr varsayılanlar) ---
  // Bir borçluya belirli pencerede yapılabilecek azami arama. Aşılırsa arama
  // DÜŞÜRÜLMEZ, limit penceresi açılınca yeniden ZAMANLANIR.
  MAX_CALLS_PER_DEBTOR_PER_DAY: z.coerce.number().int().nonnegative().default(1),
  MAX_CALLS_PER_DEBTOR_PER_WEEK: z.coerce.number().int().nonnegative().default(3),
  // Bir borca toplam azami arama (0 = limitsiz).
  MAX_TOTAL_CALLS_PER_DEBTOR: z.coerce.number().int().nonnegative().default(0),

  // --- Outcome-bazlı tekrar deneme (BullMQ teknik retry'dan AYRI) ---
  // Arama BAŞARIYLA bitti ama sonuç tekrar gerektiriyorsa yeni bir Call planlanır.
  // Tüm bu retry'lar yine pencere + taciz kapılarından geçer.
  RETRY_NO_ANSWER_DELAY_HOURS: z.coerce.number().nonnegative().default(4),
  MAX_NO_ANSWER_ATTEMPTS: z.coerce.number().int().nonnegative().default(3),
  // PROMISE_TO_PAY: söz verilen tarihten kaç gün sonra teyit/takip araması (0=kapalı).
  PROMISE_FOLLOWUP_OFFSET_DAYS: z.coerce.number().int().nonnegative().default(1),
  // REFUSED sonrası tekrar (gün; 0 = asla tekrar arama — varsayılan, ısrar=taciz).
  RETRY_REFUSED_AFTER_DAYS: z.coerce.number().int().nonnegative().default(0),

  // --- Kırılan ödeme sözü döngüsü (broken-promise) ---
  // Söz tarihinden bu kadar gün sonra ödeme gelmediyse "kırıldı" sayılır (grace).
  BROKEN_PROMISE_GRACE_DAYS: z.coerce.number().int().nonnegative().default(1),
  // Bir kırılan söz için en çok kaç takip araması (sonsuz ısrar = taciz).
  BROKEN_PROMISE_MAX_FOLLOWUPS: z.coerce.number().int().nonnegative().default(1),
  // Kırılan söz takibi bu kadar saat sonrasına planlanır.
  BROKEN_PROMISE_FOLLOWUP_DELAY_HOURS: z.coerce.number().nonnegative().default(2),
  // Kırılan söz taraması kaç dakikada bir çalışsın (0 = kapalı).
  BROKEN_PROMISE_SWEEP_MINUTES: z.coerce.number().int().nonnegative().default(60),

  // Retell webhook maliyeti (combined_cost) minör birimdir (USD-cent). Kuruşa
  // çevirmek için çarpan: kuruş = round(costMinor * RETELL_COST_MINOR_TO_KURUS).
  // Örn. 1 USD = 32 TRY ise 1 USD-cent = 32 kuruş → çarpan 32. Varsayılan 1 =
  // çevrim yok (operatör gerçek kuru girene dek ham değer; raporda görünür kalsın).
  RETELL_COST_MINOR_TO_KURUS: z.coerce.number().nonnegative().default(1),

  // --- Hız limiti (operatör hattı/maliyet koruması) ---
  // CALL_RATE_DURATION_MS içinde en çok CALL_RATE_MAX arama işlenir.
  // Kampanya tüm aramaları anında kuyruğa atsa da işlenme hızı bununla sınırlanır.
  CALL_RATE_MAX: z.coerce.number().int().positive().default(10),
  CALL_RATE_DURATION_MS: z.coerce.number().int().positive().default(60_000),
});

export const env = EnvSchema.parse(process.env);
